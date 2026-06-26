// ════════════════════════════════════════════════════════════════════
//  ÁRBOL JERÁRQUICO 7×3 (Categoría → Subcategoría A/B/C) — SOLO LECTURA
// ════════════════════════════════════════════════════════════════════
//  Helper compartido de RENDER (sin acciones) extraído del patrón que
//  ya existía duplicado en:
//    · js/admin/club/panel.js        · unifiedUserTable()  (modo 'club')
//    · js/admin/individual/panel.js  · _buildIndIndex()+render (modo 'individual')
//
//  Este módulo NO toca Firestore ni emite botones de editar/eliminar. Se
//  usa donde solo hace falta VER el árbol (p. ej. el SuperAdmin mirando
//  cada club / ente individual). Los paneles Club e Individual mantienen
//  su propia copia con acciones (este helper no los modifica).
//
//  API:
//    window.renderCategoryTreeReadOnly(expandedUsers, { mode })
//      · expandedUsers: array de usuarios "expandidos por rol", donde cada
//        elemento trae u._activeRoleData = { role, category, subcategory,
//        coordinatorType?, isAuthorized?, status? }. (Mismo shape que usan
//        los dos paneles originales.)
//      · mode: 'club'        → incluye bloque Staff (Director/Coordinador)
//              'individual'   → sin bloque Staff (el admin es su propio
//                               entrenador; solo Entrenador/Padre en el árbol)
//      Devuelve un string HTML (incluye un <style> scoped para el plegado
//      anidado correcto, igual que el fix de club/panel.js).
// ════════════════════════════════════════════════════════════════════
(function () {
    'use strict';

    // Las 7 categorías y 3 subcategorías son idénticas en ambos paneles.
    const CT_CATEGORIES = [
        { id: 'prebenjamin', label: 'Prebenjamín' },
        { id: 'benjamin',    label: 'Benjamín' },
        { id: 'alevin',      label: 'Alevín' },
        { id: 'infantil',    label: 'Infantil' },
        { id: 'cadete',      label: 'Cadete' },
        { id: 'juvenil',     label: 'Juvenil' },
        { id: 'regional',    label: 'Regional' },
    ];
    const CT_SUBCATS = ['A', 'B', 'C'];
    const _validCatIds = new Set(CT_CATEGORIES.map(c => c.id));
    const _coordLabel = { f7: 'F7', f11: 'F11', f711: 'F7&11' };

    // Roles que van al árbol (Entrenador / Padre) en cualquiera de los dos
    // modelos de datos (club usa 'user'/'parent'; individual añade variantes).
    const _COACH_ROLES  = new Set(['user', 'entrenador_individual']);
    const _PARENT_ROLES = new Set(['parent', 'parent_individual']);

    // ── Escapado seguro con fallback (admin-shared.js suele definirlos) ──
    function _eH(s) {
        if (typeof escapeHtml === 'function') return escapeHtml(s == null ? '' : s);
        return String(s == null ? '' : s)
            .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
    }

    // Normaliza categoría: acepta 'prebenjamin' o el slot combinado 'prebenjamin_a'.
    function _normCat(r) {
        let cat = String(r.category || r.categoryLabel || '').trim().toLowerCase();
        return cat.replace(/_[abc]$/, '');
    }
    // Normaliza subcategoría: directa o derivada del sufijo '_a/_b/_c'.
    function _normSub(r) {
        let sub = String(r.subcategory || '').trim().toUpperCase();
        if (!sub) {
            const m = String(r.category || '').match(/_([abc])$/i);
            if (m) sub = m[1].toUpperCase();
        }
        return sub;
    }

    function _regDate(u) {
        if (u.createdAt) {
            let d;
            if (u.createdAt.toDate) d = u.createdAt.toDate();
            else if (typeof u.createdAt === 'number') d = new Date(u.createdAt);
            else if (u.createdAt.seconds) d = new Date(u.createdAt.seconds * 1000);
            else d = new Date(u.createdAt);
            if (d instanceof Date && !isNaN(d.getTime())) return d.toLocaleDateString();
        } else if (u.authorizedAt) {
            const d = new Date(u.authorizedAt);
            if (d instanceof Date && !isNaN(d.getTime())) return d.toLocaleDateString();
        }
        return '–';
    }

    // ── Índice O(n): staff + (catId → subId → [usuarios]) ────────────────
    function _buildIndex(eUsers, mode) {
        const staff     = [];          // {u, role, coordType}  (solo modo 'club')
        const byCatSub  = new Map();   // catId -> (subId -> [usuarios])
        const catHasAny = new Set();
        const subHasAny = new Set();

        (eUsers || []).forEach(u => {
            const r = u._activeRoleData || {};
            const role = r.role || u.role;

            if (mode === 'club') {
                if (role === 'director') { staff.push({ u, role, coordType: '' }); return; }
                if (role === 'coordinator') {
                    let ct = '';
                    const n = String(r.coordinatorType || r.requestedCoordinatorType || '').trim().toLowerCase();
                    if (n === 'f7' || n === 'f11' || n === 'f711') ct = n;
                    if (!ct && typeof window._cronosStaffCoordinatorType === 'function') {
                        ct = window._cronosStaffCoordinatorType(u) || '';
                    }
                    if (!ct) return; // coordinador sin tipo válido → excluir (histórico)
                    staff.push({ u, role, coordType: ct });
                    return;
                }
            }

            // Solo Entrenador / Padre van al árbol.
            if (!_COACH_ROLES.has(role) && !_PARENT_ROLES.has(role)) return;
            const cat = _normCat(r);
            const sub = _normSub(r);
            if (!_validCatIds.has(cat)) return;      // sin categoría válida → excluir
            if (!CT_SUBCATS.includes(sub)) return;   // sin subcategoría válida → excluir
            if (!byCatSub.has(cat)) byCatSub.set(cat, new Map());
            const subMap = byCatSub.get(cat);
            if (!subMap.has(sub)) subMap.set(sub, []);
            subMap.get(sub).push(u);
            catHasAny.add(cat);
            subHasAny.add(cat + '|' + sub);
        });
        return { staff, byCatSub, catHasAny, subHasAny };
    }

    // ── Fila plana de un usuario (Entrenador/Padre) — SIN acciones ───────
    function _userRowHtml(u) {
        const r = u._activeRoleData || {};
        const roleMeta = (window.ROLE_META || {})[r.role] || { icon: '👤', color: '#8b949e', label: r.role || 'Usuario' };
        let name = u.firstName || u.displayName || (u.email ? u.email.split('@')[0] : 'Usuario');
        name = _eH(String(name).split(' ')[0]);
        const pending = (r.isAuthorized === false || r.status === 'pending_individual' || r.status === 'pending_club_admin' || r.status === 'pending_sa' || r.status === 'pending')
            ? '<span style="font-size:0.62rem;color:#ffa500;margin-left:0.3rem;">⏳</span>' : '';
        return '' +
            '<div style="display:grid; grid-template-columns:minmax(96px,auto) minmax(80px,1fr) minmax(0,2fr) auto;' +
            ' align-items:center; gap:0.6rem; padding:0.55rem 0.6rem; border-bottom:1px solid rgba(255,255,255,0.05);">' +
            '<div style="font-size:0.7rem; color:' + roleMeta.color + '; font-weight:600; white-space:nowrap;">' + roleMeta.icon + ' ' + _eH(roleMeta.label) + pending + '</div>' +
            '<div style="font-weight:600; color:white; font-size:0.85rem; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;">' + name + '</div>' +
            '<div style="font-size:0.74rem; color:#8b949e; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;" title="' + _eH(u.email || '') + '">' + _eH(u.email || '') + '</div>' +
            '<div style="font-size:0.72rem; color:#8b949e; white-space:nowrap;">' + _eH(_regDate(u)) + '</div>' +
            '</div>';
    }

    // ── Cabecera de columnas de una subcategoría ─────────────────────────
    function _rowHeaderHtml() {
        const th = (t) => '<div style="font-size:0.62rem; font-weight:700; color:#79c0ff; text-transform:uppercase; letter-spacing:0.6px;">' + t + '</div>';
        return '' +
            '<div style="display:grid; grid-template-columns:minmax(96px,auto) minmax(80px,1fr) minmax(0,2fr) auto;' +
            ' align-items:center; gap:0.6rem; padding:0.4rem 0.6rem; border-bottom:1px solid rgba(255,255,255,0.1);">' +
            th('Rol') + th('Nombre') + th('Email') + th('Fecha') +
            '</div>';
    }

    // ── Bloque Staff (solo modo 'club'), SIN acciones ───────────────────
    function _staffBlockHtml(staff) {
        const ordered = staff.slice().sort((a, b) =>
            (a.role === 'director' ? 0 : 1) - (b.role === 'director' ? 0 : 1));
        const items = ordered.map(function (s) {
            const u = s.u, role = s.role, coordType = s.coordType;
            const roleMeta = (window.ROLE_META || {})[role] || { icon: '👤', color: '#8b949e', label: role };
            let name = u.firstName || u.displayName || (u.email ? u.email.split('@')[0] : 'Usuario');
            name = _eH(String(name).split(' ')[0]);
            const modBadge = coordType
                ? '<span class="sa-badge" style="background:rgba(210,168,255,0.15); color:#d2a8ff;">' + (_coordLabel[coordType] || coordType) + '</span>'
                : '';
            return '' +
                '<div style="display:flex; align-items:center; gap:0.6rem; padding:0.5rem 0.6rem; border-bottom:1px solid rgba(255,255,255,0.05);">' +
                '<span style="font-size:0.85rem; font-weight:700; color:white;">' + name + '</span>' +
                '<span style="font-size:0.7rem; color:' + roleMeta.color + '; font-weight:600;">' + roleMeta.icon + ' ' + _eH(roleMeta.label) + '</span>' +
                modBadge +
                '<span style="font-size:0.72rem; color:#8b949e; margin-left:auto; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; max-width:50%;" title="' + _eH(u.email || '') + '">' + _eH(u.email || '') + '</span>' +
                '</div>';
        }).join('');
        return '' +
            '<div style="background:rgba(240,136,62,0.05); border:1px solid rgba(240,136,62,0.25); border-radius:10px; padding:0.8rem 0.9rem; margin-bottom:1rem;">' +
            '<div style="font-size:0.78rem; font-weight:700; color:#f0883e; text-transform:uppercase; letter-spacing:1px; margin-bottom:0.5rem;">📋 Staff del Club</div>' +
            (items || '<div style="font-size:0.78rem; color:#8b949e; padding:0.4rem 0;">Sin staff (Director / Coordinadores) registrado.</div>') +
            '</div>';
    }

    // ── Subtarjeta (nivel 2): subcategoría A/B/C ─────────────────────────
    function _subcategoryCardHtml(subId, usersArr, hasAny) {
        const dot = hasAny
            ? '<span class="sa-badge" style="background:rgba(63,185,80,0.18); color:#3fb950;">' + usersArr.length + '</span>'
            : '<span style="font-size:0.7rem; color:#6e7681;">vacía</span>';
        const body = hasAny
            ? _rowHeaderHtml() + usersArr.map(_userRowHtml).join('')
            : '<div style="font-size:0.75rem; color:#6e7681; padding:0.5rem 0.6rem;">Sin usuarios en esta subcategoría.</div>';
        return '' +
            '<div class="sa-card ct-ro-card" style="margin-bottom:0.5rem; padding:0.6rem 0.7rem; border-color:rgba(255,255,255,0.08);">' +
            '<div class="sa-card-head" onclick="this.closest(\'.sa-card\').classList.toggle(\'expanded\')">' +
            '<div class="sa-card-title" style="font-size:0.82rem;">' +
            '<span class="sa-chevron">▼</span>' +
            '<span>Subcategoría ' + subId + '</span>' + dot +
            '</div></div>' +
            '<div class="sa-card-body">' + body + '</div>' +
            '</div>';
    }

    // ── Tarjeta (nivel 1): categoría ─────────────────────────────────────
    function _categoryCardHtml(catDef, idx) {
        const subMap = idx.byCatSub.get(catDef.id) || new Map();
        const catHas = idx.catHasAny.has(catDef.id);
        const subsHtml = CT_SUBCATS.map(function (subId) {
            const usersArr = subMap.get(subId) || [];
            const subHas = idx.subHasAny.has(catDef.id + '|' + subId);
            return _subcategoryCardHtml(subId, usersArr, subHas);
        }).join('');
        const dot = catHas
            ? '<span style="display:inline-block; width:9px; height:9px; border-radius:50%; background:#3fb950; box-shadow:0 0 6px rgba(63,185,80,0.7);"></span>'
            : '<span style="display:inline-block; width:9px; height:9px; border-radius:50%; background:rgba(255,255,255,0.12);"></span>';
        return '' +
            '<div class="sa-card ct-ro-card" style="margin-bottom:0.6rem; border-color:rgba(88,166,255,0.2);">' +
            '<div class="sa-card-head" onclick="this.closest(\'.sa-card\').classList.toggle(\'expanded\')">' +
            '<div class="sa-card-title">' +
            '<span class="sa-chevron">▼</span>' +
            '<span>' + _eH(catDef.label) + '</span>' + dot +
            '</div></div>' +
            '<div class="sa-card-body">' + subsHtml + '</div>' +
            '</div>';
    }

    // Fix de plegado anidado (igual que js/admin/club/panel.js): el CSS
    // compartido usa el selector descendiente .sa-card.expanded .sa-card-body,
    // que con tarjetas anidadas revelaría TODOS los niveles. Acotamos con el
    // selector de hijo directo solo para estas tarjetas del árbol read-only.
    const _SCOPED_STYLE =
        '<style>' +
        '.ct-ro-card.expanded > .sa-card-body { display: block; }' +
        '.ct-ro-card > .sa-card-body { display: none; }' +
        '.ct-ro-card.expanded > .sa-card-head .sa-chevron { transform: rotate(0deg); }' +
        '</style>';

    // ── API pública ──────────────────────────────────────────────────────
    function renderCategoryTreeReadOnly(expandedUsers, opts) {
        const mode = (opts && opts.mode) || 'club';
        const idx = _buildIndex(expandedUsers, mode);
        const treeHtml = CT_CATEGORIES.map(function (c) { return _categoryCardHtml(c, idx); }).join('');
        const staffHtml = (mode === 'club') ? _staffBlockHtml(idx.staff) : '';
        return _SCOPED_STYLE +
            '<div style="margin-bottom:0.5rem;">' + staffHtml + treeHtml + '</div>';
    }

    window.renderCategoryTreeReadOnly = renderCategoryTreeReadOnly;
    // Exponer constantes por si algún consumidor las necesita (no obligatorio).
    window.CT_CATEGORIES = window.CT_CATEGORIES || CT_CATEGORIES;
    window.CT_SUBCATS = window.CT_SUBCATS || CT_SUBCATS;
})();

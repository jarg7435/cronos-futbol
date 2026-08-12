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

    // Las 9 categorías y 3 subcategorías son idénticas en ambos paneles.
    //
    // ⚠️ EL LITERAL DE LAS ETIQUETAS ES EL QUE FIJÓ EL AUTOR (2026-08-12) y no
    // se "corrige": 'Regional FEM' con FEM en mayúsculas y 'FUTureFEM' con esa
    // capitalización exacta. Van a continuación de 'Regional', y el ORDEN de
    // este array es el orden en que se pintan los tres árboles.
    const CT_CATEGORIES = [
        { id: 'prebenjamin',  label: 'Prebenjamín' },
        { id: 'benjamin',     label: 'Benjamín' },
        { id: 'alevin',       label: 'Alevín' },
        { id: 'infantil',     label: 'Infantil' },
        { id: 'cadete',       label: 'Cadete' },
        { id: 'juvenil',      label: 'Juvenil' },
        { id: 'regional',     label: 'Regional' },
        { id: 'regional_fem', label: 'Regional FEM' },
        { id: 'futurefem',    label: 'FUTureFEM' },
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
    // ⚠️ EL ESPACIO SE CONVIERTE EN '_' ANTES DE QUITAR EL SUFIJO: desde que hay
    // categorías de DOS PALABRAS ('Regional FEM'), el respaldo por categoryLabel
    // llega como 'regional fem a' y sin esto no casaría nunca con el id
    // 'regional_fem' — el usuario caería fuera del árbol sin ningún error.
    function _normCat(r) {
        let cat = String(r.category || r.categoryLabel || '').trim().toLowerCase();
        cat = cat.replace(/[\s-]+/g, '_');
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
        const staff      = [];          // {u, role, coordType}  (solo modo 'club')
        const byCatSub   = new Map();   // catId -> (subId -> [usuarios])
        const catHasAny  = new Set();
        const subHasAny  = new Set();
        const unassigned = [];          // entrenadores/padres sin categoría válida

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
            // Si no tiene categoría/subcategoría válida, va a 'unassigned' (visible en el panel)
            if (!_validCatIds.has(cat) || !CT_SUBCATS.includes(sub)) {
                unassigned.push(u);
                return;
            }
            if (!byCatSub.has(cat)) byCatSub.set(cat, new Map());
            const subMap = byCatSub.get(cat);
            if (!subMap.has(sub)) subMap.set(sub, []);
            subMap.get(sub).push(u);
            catHasAny.add(cat);
            subHasAny.add(cat + '|' + sub);
        });
        return { staff, byCatSub, catHasAny, subHasAny, unassigned };
    }

    // ── Fila plana de un usuario (Entrenador/Padre) — SIN acciones ───────
    function _userRowHtml(u) {
        const r = u._activeRoleData || {};
        const roleMeta = (window.ROLE_META || {})[r.role] || { icon: '👤', color: '#8b949e', label: r.role || 'Usuario' };

        // Nombre completo: busca en varios campos para cubrir todos los formatos de registro
        const _firstName = u.firstName || u.nombre || '';
        const _lastName  = u.lastName  || u.surname || u.apellidos || u.apellido || '';
        let fullName = [_firstName, _lastName].filter(Boolean).join(' ').trim();
        if (!fullName) fullName = u.fullName || u.name || u.displayName || '';
        if (!fullName && u.email) fullName = u.email.split('@')[0];  // último recurso
        if (!fullName) fullName = 'Usuario';
        fullName = _eH(fullName);

        const pending = (r.isAuthorized === false || r.status === 'pending_individual' || r.status === 'pending_club_admin' || r.status === 'pending_sa' || r.status === 'pending')
            ? '<span style="font-size:0.62rem;color:#ffa500;margin-left:0.3rem;">⏳</span>' : '';

        // ID completo en fuente monospace pequeña — totalmente visible y copiable
        const fullId = _eH(String(u.id || u.uid || ''));
        const idEl = fullId
            ? '<span style="font-size:0.6rem;color:#58a6ff;background:rgba(88,166,255,0.06);' +
              'padding:2px 5px;border-radius:4px;font-family:monospace;cursor:pointer;word-break:break-all;" ' +
              'title="Copiar ID" onclick="navigator.clipboard.writeText(\'' + fullId + '\').then(()=>{this.style.color=\'#3fb950\';setTimeout(()=>this.style.color=\'#58a6ff\',1500);})">' +
              fullId + '</span>'
            : '<span style="color:#4d5566;font-size:0.6rem;">—</span>';

        return '' +
            '<div style="display:grid; grid-template-columns:minmax(96px,auto) minmax(100px,1fr) minmax(0,2fr) auto;' +
            ' align-items:start; gap:0.6rem; padding:0.55rem 0.6rem; border-bottom:1px solid rgba(255,255,255,0.05);">' +
            '<div style="font-size:0.7rem; color:' + roleMeta.color + '; font-weight:600; white-space:nowrap; padding-top:2px;">' + roleMeta.icon + ' ' + _eH(roleMeta.label) + pending + '</div>' +
            '<div style="font-weight:600; color:white; font-size:0.82rem; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;">' + fullName + '</div>' +
            '<div style="font-size:0.74rem; color:#8b949e; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;" title="' + _eH(u.email || '') + '">' + _eH(u.email || '') + '</div>' +
            '<div style="font-size:0.68rem; color:#8b949e; white-space:nowrap;">' + _eH(_regDate(u)) + '</div>' +
            '</div>' +
            '<div style="padding:0 0.6rem 0.45rem 0.6rem; border-bottom:1px solid rgba(255,255,255,0.05); margin-top:-0.3rem;">' +
            '<span style="font-size:0.6rem;color:#4d5566;margin-right:4px;">ID:</span>' + idEl +
            '</div>';
    }

    // ── Cabecera de columnas de una subcategoría ─────────────────────────
    function _rowHeaderHtml() {
        const th = (t) => '<div style="font-size:0.62rem; font-weight:700; color:#79c0ff; text-transform:uppercase; letter-spacing:0.6px;">' + t + '</div>';
        return '' +
            '<div style="display:grid; grid-template-columns:minmax(96px,auto) minmax(100px,1fr) minmax(0,2fr) auto;' +
            ' align-items:center; gap:0.6rem; padding:0.4rem 0.6rem; border-bottom:1px solid rgba(255,255,255,0.1);">' +
            th('Rol') + th('Nombre') + th('Email') + th('Fecha') +
            '</div>';
    }

    // ── Sección usuarios sin categoría asignada ──────────────────────────
    function _unassignedBlockHtml(unassigned) {
        if (!unassigned || !unassigned.length) return '';
        const rows = _rowHeaderHtml() + unassigned.map(_userRowHtml).join('');
        return '' +
            '<div style="margin-bottom:0.6rem; border:1px solid rgba(255,215,0,0.2); border-radius:10px; overflow:hidden;">' +
            '<div style="background:rgba(255,215,0,0.06); padding:0.45rem 0.9rem; display:flex; align-items:center; gap:0.5rem;">' +
            '<span style="font-size:0.78rem; font-weight:700; color:#ffd700;">⚠️ Sin categoría/subcategoría asignada (' + unassigned.length + ')</span>' +
            '</div>' +
            '<div>' + rows + '</div>' +
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
        const staffHtml    = (mode === 'club') ? _staffBlockHtml(idx.staff) : '';
        const unassignedHtml = _unassignedBlockHtml(idx.unassigned);
        return _SCOPED_STYLE +
            '<div style="margin-bottom:0.5rem;">' + staffHtml + unassignedHtml + treeHtml + '</div>';
    }

    window.renderCategoryTreeReadOnly = renderCategoryTreeReadOnly;
    // ⚠️ FUENTE ÚNICA DEL VOCABULARIO (2026-07-30). Ya no es "por si algún
    // consumidor las necesita": admin/club/panel.js y admin/individual/panel.js
    // tenían cada uno su propia copia literal de las mismas 7 categorías y ahora
    // leen de aquí. Añadir una categoría se hace en UN sitio.
    window.CT_CATEGORIES = window.CT_CATEGORIES || CT_CATEGORIES;
    window.CT_SUBCATS = window.CT_SUBCATS || CT_SUBCATS;

    // ════════════════════════════════════════════════════════════════
    //  API GENÉRICA — añadida para el panel del Director Deportivo
    //  (implementar.txt, 2026-07-30, fase 1)
    //
    //  Lo de arriba agrupa USUARIOS y pinta filas con su rol y su email. El
    //  panel del Director necesita agrupar INFORMES, CONVOCATORIAS y
    //  ENTRENAMIENTOS con el mismo árbol, así que lo que se comparte es la
    //  estructura y el contenido de la hoja va como callback.
    //
    //  ⚠️ NORMALIZACIÓN DISTINTA, Y A PROPÓSITO. La _normCat de arriba hace
    //  toLowerCase() y quita el sufijo _a/_b/_c, pero NO quita tildes: vale para
    //  usuarios, cuya categoría viene de un formulario y ya es un id. Los
    //  informes y convocatorias guardan la categoría TAL COMO VENÍA DEL PARTIDO,
    //  y ahí aparecen "Alevín", "F7_Alevin_A" o "Alevin B". Con la de arriba
    //  todas esas caerían fuera del árbol. Estas replican _normCat/_normSubcat
    //  de js/coach/comms/panel.js, que es la forma canónica del proyecto; la
    //  equivalencia entre ambas la fija scripts/test_category_tree.js.
    // ════════════════════════════════════════════════════════════════

    window.ctNormCat = function (raw) {
        if (raw == null) return '';
        // \p{M} = marcas combinantes, en vez del rango literal [U+0300-U+036F]:
        // escrito con los caracteres de verdad serían DOS CARACTERES INVISIBLES
        // en el fuente, y cualquier reescritura con la codificación equivocada
        // los convertiría en mojibake — "Alevín" y "Alevin" pasarían a ser
        // categorías distintas y los informes se irían a "Sin clasificar" sin
        // que nada fallase a gritos. Así el fuente es 100% ASCII.
        var s = String(raw).normalize('NFD').replace(/\p{M}/gu, '').toLowerCase().trim();
        s = s.replace(/^(f7_|f8_|f11_)/, '').replace(/_[abc]$/i, '').replace(/\s+[abc]$/i, '');
        // 🔑 CATEGORÍAS DE DOS PALABRAS (2026-08-12, 'Regional FEM'): el mismo
        // equipo llega como 'Regional FEM', 'regional_fem' o 'f11_regional_fem'
        // según el origen. Se unifica al id con guion bajo DESPUÉS de quitar el
        // sufijo A/B/C, que es quien distingue 'Regional FEM B' de la categoría.
        s = s.trim().replace(/[\s-]+/g, '_');
        if (s === 'future_fem' || s === 'futuro_fem') s = 'futurefem';
        return s;
    };

    window.ctNormSubcat = function (raw) {
        if (raw == null) return '';
        var s = String(raw).trim().toUpperCase();
        var m = s.match(/([ABC])$/);
        return m ? m[1] : s;
    };

    // Devuelve { byCatSub: Map<catId, Map<subId, item[]>>, sinClasificar, total }.
    // ⚠️ DECISIÓN EXPLÍCITA DEL AUTOR (2026-07-30): lo no clasificable NO se
    // descarta, se agrupa aparte. El árbol de usuarios de arriba sí lo descarta,
    // pero allí son altas incompletas; aquí serían informes y convocatorias que
    // HOY SE VEN en el panel del Director, y hacerlos desaparecer al introducir
    // el árbol sería una regresión visible.
    window.ctGroupByCatSub = function (items, getCat, getSub) {
        var byCatSub = new Map();
        var sinClasificar = [];
        var valid = new Set((window.CT_CATEGORIES || []).map(function (c) { return c.id; }));

        (items || []).forEach(function (it) {
            var cat = window.ctNormCat(getCat ? getCat(it) : '');
            var sub = window.ctNormSubcat(getSub ? getSub(it) : '');
            if (!valid.has(cat) || (window.CT_SUBCATS || []).indexOf(sub) === -1) {
                sinClasificar.push(it);
                return;
            }
            if (!byCatSub.has(cat)) byCatSub.set(cat, new Map());
            var subMap = byCatSub.get(cat);
            if (!subMap.has(sub)) subMap.set(sub, []);
            subMap.get(sub).push(it);
        });

        return { byCatSub: byCatSub, sinClasificar: sinClasificar, total: (items || []).length };
    };

    window.ctCountInCat = function (groups, catId) {
        var subMap = groups && groups.byCatSub && groups.byCatSub.get(catId);
        if (!subMap) return 0;
        var n = 0;
        subMap.forEach(function (arr) { n += arr.length; });
        return n;
    };

    // CSS propio con clases `ct-tree-*`. El panel del Director NO inyecta
    // SA_CSS, y metérselo arrastraría .sa-modal/.sa-topbar, que chocarían con
    // sus estilos. Sin este CSS el árbol se vería siempre desplegado.
    window.CT_TREE_CSS = '<style>' +
        '.ct-tree-cat,.ct-tree-sub{border:1px solid rgba(255,255,255,0.08);border-radius:10px;' +
            'background:rgba(255,255,255,0.02);overflow:hidden;}' +
        '.ct-tree-cat{margin-bottom:0.6rem;border-color:rgba(88,166,255,0.2);}' +
        '.ct-tree-sub{margin-bottom:0.5rem;}' +
        '.ct-tree-head{display:flex;justify-content:space-between;align-items:center;gap:0.5rem;' +
            'padding:0.7rem 0.9rem;cursor:pointer;user-select:none;}' +
        '.ct-tree-head:hover{background:rgba(255,255,255,0.03);}' +
        '.ct-tree-title{font-weight:700;font-size:0.92rem;color:white;display:flex;' +
            'align-items:center;gap:0.5rem;min-width:0;}' +
        '.ct-tree-sub .ct-tree-title{font-size:0.82rem;}' +
        '.ct-tree-chevron{display:inline-block;transition:transform 0.15s;color:#8b949e;font-size:0.75rem;}' +
        '.ct-tree-open>.ct-tree-head .ct-tree-chevron{transform:rotate(90deg);}' +
        '.ct-tree-count{font-size:0.7rem;font-weight:700;padding:0.1rem 0.45rem;border-radius:20px;' +
            'background:rgba(63,185,80,0.18);color:#3fb950;}' +
        '.ct-tree-count.ct-tree-zero{background:rgba(255,255,255,0.06);color:#6e7681;}' +
        '.ct-tree-body{display:none;padding:0 0.9rem 0.8rem;}' +
        '.ct-tree-open>.ct-tree-body{display:block;}' +
        '.ct-tree-empty{font-size:0.75rem;color:#6e7681;padding:0.5rem 0.2rem;}' +
        '.ct-tree-none{border-color:rgba(240,136,62,0.35);}' +
        '.ct-tree-none .ct-tree-title{color:#f0883e;}' +
        '</style>';

    // Lo llaman los onclick del HTML generado, que se evalúan en ámbito global.
    window.ctToggleNode = function (el) {
        var node = el && el.closest ? el.closest('.ct-tree-cat, .ct-tree-sub') : null;
        if (node) node.classList.toggle('ct-tree-open');
    };

    // opts = { items, getCat, getSub, renderLeaf(item)->html, emptyText, hideEmpty,
    //          renderSubHeader(items, catId, subId)->html }
    // Todas las ramas arrancan PLEGADAS (decisión del autor): el panel abre
    // limpio y se despliega sólo lo que interese.
    //
    // renderSubHeader (fase 5): bloque que se pinta UNA VEZ en la cabeza del
    // cuerpo de cada subcategoría con algo, antes de las hojas. Existe porque la
    // tabla resumen de temporada que pidió el autor es POR EQUIPO, y renderLeaf
    // sólo puede hablar de un elemento; sin esto habría que replicar el marcado
    // del árbol fuera del módulo. Opcional: si no se pasa, el árbol es idéntico.
    window.ctRenderTree = function (opts) {
        opts = opts || {};
        var renderLeaf = opts.renderLeaf || function () { return ''; };
        var renderSubHeader = typeof opts.renderSubHeader === 'function' ? opts.renderSubHeader : null;
        var emptyText  = opts.emptyText || 'Sin elementos en esta subcategoría.';
        var groups = window.ctGroupByCatSub(opts.items, opts.getCat, opts.getSub);

        var cats = (window.CT_CATEGORIES || []).map(function (catDef) {
            var n = window.ctCountInCat(groups, catDef.id);
            if (opts.hideEmpty && n === 0) return '';
            var subMap = groups.byCatSub.get(catDef.id) || new Map();

            var subs = (window.CT_SUBCATS || []).map(function (subId) {
                var arr = subMap.get(subId) || [];
                var cabecera = (arr.length && renderSubHeader)
                    ? (renderSubHeader(arr, catDef.id, subId) || '') : '';
                var body = arr.length
                    ? (cabecera + arr.map(renderLeaf).join(''))
                    : '<div class="ct-tree-empty">' + _eH(emptyText) + '</div>';
                return '' +
                '<div class="ct-tree-sub">' +
                    '<div class="ct-tree-head" onclick="ctToggleNode(this)">' +
                        '<div class="ct-tree-title"><span class="ct-tree-chevron">&#9654;</span>' +
                            '<span>Subcategoría ' + _eH(subId) + '</span></div>' +
                        '<span class="ct-tree-count' + (arr.length ? '' : ' ct-tree-zero') + '">' +
                            arr.length + '</span>' +
                    '</div>' +
                    '<div class="ct-tree-body">' + body + '</div>' +
                '</div>';
            }).join('');

            return '' +
            '<div class="ct-tree-cat">' +
                '<div class="ct-tree-head" onclick="ctToggleNode(this)">' +
                    '<div class="ct-tree-title"><span class="ct-tree-chevron">&#9654;</span>' +
                        '<span>' + _eH(catDef.label) + '</span></div>' +
                    '<span class="ct-tree-count' + (n ? '' : ' ct-tree-zero') + '">' + n + '</span>' +
                '</div>' +
                '<div class="ct-tree-body">' + subs + '</div>' +
            '</div>';
        }).join('');

        // El nodo de lo no clasificable sólo aparece si TIENE algo: si no, sería
        // ruido permanente en un club con los datos completos.
        var sin = '';
        if (groups.sinClasificar.length) {
            sin = '' +
            '<div class="ct-tree-cat ct-tree-none">' +
                '<div class="ct-tree-head" onclick="ctToggleNode(this)">' +
                    '<div class="ct-tree-title"><span class="ct-tree-chevron">&#9654;</span>' +
                        '<span>&#9888; Sin clasificar</span></div>' +
                    '<span class="ct-tree-count">' + groups.sinClasificar.length + '</span>' +
                '</div>' +
                '<div class="ct-tree-body">' +
                    groups.sinClasificar.map(renderLeaf).join('') +
                '</div>' +
            '</div>';
        }

        return window.CT_TREE_CSS + cats + sin;
    };

    // ════════════════════════════════════════════════════════════════
    //  RESOLUTOR DE CATEGORÍA/SUBCATEGORÍA (fase 2, 2026-07-30)
    //
    //  POR QUÉ HACE FALTA: los tres listados del panel del Director no traen
    //  la categoría de la misma forma.
    //    · Convocatorias   → category Y subcategory en el propio documento.
    //    · Informes colec. → las dos en el documento.
    //    · Entrenamientos  → NINGUNA. El payload sólo guarda coachUid.
    //  Sin esto, la pestaña de Entrenamientos entera caería en "Sin clasificar".
    //
    //  ⚠️ ESTE MÓDULO NO LEE LA BASE DE DATOS, y así debe seguir: recibe los
    //  documentos de usuario que el panel ya ha traído y devuelve un índice.
    //  Es lo que permite probarlo entero en un sandbox de vm.
    //
    //  🔑 DOS DECISIONES, fijadas por scripts/test_category_tree_resolver.js:
    //   1. ANTE LA DUDA NO SE ADIVINA. Un entrenador puede llevar dos equipos.
    //      Si el documento no dice de cuál es y el autor tiene más de una rama,
    //      el elemento se queda sin clasificar. Colocarlo en una rama al azar
    //      sería peor: el Director leería el informe de un equipo creyendo que
    //      es de otro.
    //   2. EL AUTOR ES coachUid, NUNCA userId/parentUid. Esos dos son el
    //      DESTINATARIO de la notificación (se añadieron para las reglas de
    //      seguridad, ver el FIX (C3) en training-notify.js). Resolver por ahí
    //      clasificaría cada convocatoria por la categoría del padre que la
    //      recibe.
    // ════════════════════════════════════════════════════════════════

    // Roles que pueden ser AUTOR de un informe/convocatoria/entrenamiento.
    // ⚠️ Deliberadamente separado de _COACH_ROLES: ése decide quién sale en el
    // árbol de USUARIOS del SuperAdmin, y añadirle 'coach' cambiaría lo que se
    // ve en ese panel, que esta fase no toca.
    const _CT_AUTHOR_ROLES = new Set(['user', 'coach', 'entrenador_individual']);

    function _ctRoleBranch(r) {
        return {
            cat: window.ctNormCat(r.category != null ? r.category : (r.categoryLabel || '')),
            sub: window.ctNormSubcat(r.subcategory || ''),
        };
    }

    // Devuelve Map<uid, { roles: [{cat, sub}] }> con las ramas de entrenador de
    // cada usuario, YA NORMALIZADAS: sin normalizar aquí, 'F7_Alevín' guardado
    // en el rol no casaría nunca con el id 'alevin' del árbol.
    window.ctBuildCoachIndex = function (userDocs) {
        const idx = new Map();
        (userDocs || []).forEach(function (u) {
            if (!u) return;
            const uid = u.id || u.uid || '';
            if (!uid) return;

            let ramas = [];
            const roles = Array.isArray(u.allRoles) ? u.allRoles : [];
            roles.forEach(function (r) {
                if (r && _CT_AUTHOR_ROLES.has(r.role)) ramas.push(_ctRoleBranch(r));
            });
            // Respaldo en la raíz para el usuario mono-rol, misma lógica que el
            // fallback de js/admin/club/panel.js.
            if (!ramas.length && _CT_AUTHOR_ROLES.has(u.role)) ramas.push(_ctRoleBranch(u));

            // Una rama sin categoría reconocible no sirve para resolver nada.
            ramas = ramas.filter(function (r) { return !!r.cat; });
            if (!ramas.length) return;
            idx.set(uid, { roles: ramas });
        });
        return idx;
    };

    // ctResolveCatSub(item, coachIndex[, opts]) → { cat, sub, source }
    //   source: 'doc'        el documento lo traía todo (no se mira al autor)
    //           'autor'      resuelto por la ficha del entrenador
    //           'ambiguo'    el autor lleva varios equipos → sin clasificar
    //           'incompleto' el autor tiene una rama, pero sin subcategoría
    //           'sin-autor'  no hay coachUid, o ya no está en el club
    //   Con cat/sub vacías, ctGroupByCatSub lo manda a "Sin clasificar" solo.
    //   opts = { getCat, getSub, getAuthorUid } para las formas que no son la
    //   de una notificación (los informes se agrupan antes por partido).
    window.ctResolveCatSub = function (item, coachIndex, opts) {
        opts = opts || {};
        item = item || {};
        const getCat = opts.getCat || function (i) {
            return i.category != null ? i.category : (i.categoryLabel || '');
        };
        const getSub = opts.getSub || function (i) { return i.subcategory || ''; };
        // 🔑 coachUid y nada más: ver la decisión 2 de la cabecera.
        const getAuthorUid = opts.getAuthorUid || function (i) { return i.coachUid || ''; };

        const validCats = new Set((window.CT_CATEGORIES || []).map(function (c) { return c.id; }));
        const validSubs = (window.CT_SUBCATS || []);
        const esSub = function (s) { return validSubs.indexOf(s) !== -1; };

        const cat = window.ctNormCat(getCat(item));
        const sub = window.ctNormSubcat(getSub(item));
        const catOk = validCats.has(cat);

        // Camino normal de convocatorias e informes: el documento se basta.
        if (catOk && esSub(sub)) return { cat: cat, sub: sub, source: 'doc' };

        const entry = (coachIndex && typeof coachIndex.get === 'function')
            ? coachIndex.get(getAuthorUid(item)) : null;
        const ramas = (entry && entry.roles) || [];

        // Caso histórico: el documento trae la categoría pero la subcategoría
        // llegó vacía (es lo que deja _cMatchSubcatFor cuando no encuentra
        // coincidencia exacta). Se completa desde la rama que casa.
        if (catOk) {
            const casan = ramas.filter(function (r) { return r.cat === cat && esSub(r.sub); });
            if (casan.length === 1) return { cat: cat, sub: casan[0].sub, source: 'autor' };
            return { cat: '', sub: '', source: casan.length ? 'ambiguo' : 'incompleto' };
        }

        // El documento no dice nada (entrenamientos): sólo se resuelve si el
        // autor tiene UNA sola rama completa.
        const completas = ramas.filter(function (r) { return validCats.has(r.cat) && esSub(r.sub); });
        if (completas.length === 1) {
            return { cat: completas[0].cat, sub: completas[0].sub, source: 'autor' };
        }
        if (completas.length > 1 || ramas.length > 1) return { cat: '', sub: '', source: 'ambiguo' };
        return { cat: '', sub: '', source: ramas.length ? 'incompleto' : 'sin-autor' };
    };

    // ════════════════════════════════════════════════════════════════
    //  TABLA RESUMEN ACUMULADA DE TEMPORADA (fase 5, 2026-07-30)
    //
    //  Va en la parte alta de cada subcategoría del panel del Director, encima
    //  del listado de informes partido a partido.
    //
    //  DE DÓNDE SALEN LOS JUGADORES, y por qué NO de la plantilla: la plantilla
    //  vive en users/{coachUid}/cronos_data/main y su regla sólo la deja leer a
    //  su dueño; además ese documento contiene cronos_email_config, o sea los
    //  emails y teléfonos de TODOS los padres, así que abrirlo a la dirección
    //  sería ampliar el acceso a datos personales. DECISIÓN DEL AUTOR: la tabla
    //  se construye con los jugadores que aparecen en los informes. Un jugador
    //  nunca convocado no figura; a cambio no se tocan permisos y se cubre todo
    //  el histórico.
    //
    //  🔑 LAS TRES TRAMPAS DE LOS DATOS (las fija test_player_stats_accumulator.js):
    //   1. minutesPlayed NO ES UN NÚMERO: es "MM:SS" (formatTime). Y los docs
    //      escritos sin formatTime cargado traen los SEGUNDOS en crudo. Se
    //      aceptan las dos formas, se acumula en segundos y se redondea AL FINAL
    //      (redondear cada partido daría 89 donde son 90).
    //   2. LAS AMARILLAS NO SE PUEDEN CONTAR DE `cards`: es un solo campo y la
    //      segunda amarilla lo sobrescribe a 'roja', así que un expulsado por
    //      doble amarilla saldría con CERO amarillas. Se cuentan de `history`,
    //      donde sí quedan las dos ('DOBLE AMARILLA → EXPULSADO' se tipa como
    //      'yellow' porque el parser mira 'amarilla' antes que 'roja').
    //   3. Y LAS ROJAS NO SE PUEDEN CONTAR DE `history`: en una doble amarilla
    //      no hay entrada 'red' y en una roja directa sí. Se cuentan de
    //      `cards === 'roja'`, que cubre los dos casos exactamente una vez.
    //      Sumar las dos fuentes duplicaría las rojas directas.
    // ════════════════════════════════════════════════════════════════

    // "45:30" → 2730 · "2730" → 2730 · 2730 → 2730 · basura/ausente → 0
    function _ctToSeconds(v) {
        if (typeof v === 'number' && isFinite(v)) return Math.max(0, Math.round(v));
        const s = String(v == null ? '' : v).trim();
        const mmss = s.match(/^(\d+):([0-5]?\d)$/);
        if (mmss) return parseInt(mmss[1], 10) * 60 + parseInt(mmss[2], 10);
        if (/^\d+$/.test(s)) return parseInt(s, 10);
        return 0;
    }

    // Cuenta amarillas en history, que puede venir ya parseado (objetos con
    // .type) o todavía en crudo (las cadenas de logEvent).
    function _ctYellowsIn(history) {
        if (!Array.isArray(history)) return 0;
        let n = 0;
        history.forEach(function (e) {
            if (e && typeof e === 'object') { if (e.type === 'yellow') n++; return; }
            if (typeof e === 'string' && e.toLowerCase().indexOf('amarilla') !== -1) n++;
        });
        return n;
    }

    function _ctIsRed(cards) {
        const c = String(cards == null ? '' : cards).trim().toLowerCase();
        return c === 'roja' || c === 'red';
    }

    // ctAccumulatePlayerStats(matches) → filas ordenadas por dorsal
    //   matches: los objetos agrupados por partido de reports-tab.js, cada uno
    //   con players[] (los documentos de cronos_player_reports de ese partido).
    //   fila = { number, alias, called, pj, seconds, minutes, goals, yellow, red, injuries }
    window.ctAccumulatePlayerStats = function (matches) {
        const porJugador = new Map();

        (matches || []).forEach(function (m) {
            const players = (m && Array.isArray(m.players)) ? m.players : [];
            players.forEach(function (p) {
                if (!p) return;
                const num   = String(p.playerNumber == null ? '' : p.playerNumber).trim();
                const alias = String(p.playerAlias || p.playerName || '').trim();
                // Sin dorsal se agrupa por alias; el prefijo evita que un alias
                // que parezca un número se mezcle con el dorsal de otro.
                const key = num ? ('n:' + num) : ('a:' + alias.toLowerCase());
                if (key === 'a:') return;   // ni dorsal ni alias: no es un jugador

                let f = porJugador.get(key);
                if (!f) {
                    f = { number: num, alias: alias, called: 0, pj: 0, seconds: 0,
                          minutes: 0, goals: 0, yellow: 0, red: 0, injuries: 0 };
                    porJugador.set(key, f);
                }
                // El alias puede llegar vacío en un partido y relleno en otro.
                if (alias) f.alias = alias;

                const secs = _ctToSeconds(p.minutesPlayed);
                f.called  += 1;
                if (secs > 0) f.pj += 1;      // convocado que no jugó NO suma partido
                f.seconds += secs;
                f.goals   += Number(p.goals) || 0;
                f.yellow  += _ctYellowsIn(p.history);
                if (_ctIsRed(p.cards)) f.red += 1;
                if (p.injured === true) f.injuries += 1;
            });
        });

        const filas = [...porJugador.values()];
        // 🔑 Redondeo AL FINAL, sobre el total en segundos.
        filas.forEach(function (f) { f.minutes = Math.floor(f.seconds / 60); });
        // Orden por dorsal NUMÉRICO (si no, "10" iría antes que "7"); los que no
        // tienen dorsal, al final y por alias.
        filas.sort(function (a, b) {
            const na = a.number ? parseInt(a.number, 10) : Infinity;
            const nb = b.number ? parseInt(b.number, 10) : Infinity;
            if (na !== nb) return na - nb;
            return String(a.alias).localeCompare(String(b.alias), 'es');
        });
        return filas;
    };

    window.CT_STATS_CSS = '<style>' +
        '.ct-stats-wrap{overflow-x:auto;margin-bottom:0.9rem;border:1px solid rgba(88,166,255,0.18);' +
            'border-radius:10px;background:rgba(255,255,255,0.02);}' +
        '.ct-stats{width:100%;border-collapse:collapse;font-size:0.76rem;min-width:460px;}' +
        '.ct-stats caption{caption-side:top;text-align:left;padding:0.6rem 0.8rem 0.4rem;' +
            'font-size:0.78rem;font-weight:700;color:#79c0ff;}' +
        '.ct-stats th{font-size:0.62rem;text-transform:uppercase;letter-spacing:0.5px;color:#79c0ff;' +
            'font-weight:700;padding:0.45rem 0.5rem;border-bottom:1px solid rgba(255,255,255,0.12);' +
            'text-align:center;white-space:nowrap;}' +
        '.ct-stats th.ct-stats-name,.ct-stats td.ct-stats-name{text-align:left;}' +
        '.ct-stats td{padding:0.4rem 0.5rem;border-bottom:1px solid rgba(255,255,255,0.05);' +
            'text-align:center;color:#c9d1d9;white-space:nowrap;}' +
        '.ct-stats td.ct-stats-name{color:white;font-weight:600;}' +
        '.ct-stats-dorsal{display:inline-block;min-width:1.5rem;color:#8b949e;font-size:0.7rem;}' +
        '.ct-stats tr.ct-stats-total td{border-top:1px solid rgba(255,255,255,0.15);' +
            'border-bottom:none;font-weight:700;color:#79c0ff;}' +
        '.ct-stats-zero{color:#4d5566;}' +
        '.ct-stats-empty{padding:0.8rem;font-size:0.76rem;color:#8b949e;}' +
        '</style>';

    // ctRenderStatsTable(filas[, opts]) → HTML de la tabla resumen acumulada.
    //   opts.matchCount: partidos que ha disputado el EQUIPO. Va a la celda PJ
    //   de la fila de totales; sin él, esa celda queda con un guion.
    window.ctRenderStatsTable = function (filas, opts) {
        filas = Array.isArray(filas) ? filas : [];
        opts = opts || {};
        if (!filas.length) {
            return window.CT_STATS_CSS +
                '<div class="ct-stats-wrap"><div class="ct-stats-empty">' +
                'Todavía no hay informes de este equipo, así que no hay acumulado de temporada.' +
                '</div></div>';
        }
        const cel = (n) => '<td' + (n ? '' : ' class="ct-stats-zero"') + '>' + n + '</td>';

        // 🔑 LA FILA DE TOTALES NO SUMA LO QUE NO SE PUEDE SUMAR (ajuste del
        // autor, 2026-07-30, tras verlo en producción).
        //  · PJ: sumar los partidos de cada jugador daba 71 en un equipo que
        //    había jugado 14 — es la suma de PARTICIPACIONES, y leída bajo la
        //    columna "PJ" sólo confunde. Va el número de partidos del EQUIPO,
        //    que llega en opts.matchCount; si no se sabe, un guion.
        //  · Min: sumar los minutos de toda la plantilla no significa nada
        //    (11 jugadores × 90' = 990' por partido). Guion siempre.
        //  · Goles, tarjetas y lesiones SÍ son magnitudes del equipo: se suman.
        // En las filas de CADA JUGADOR, PJ y minutos no se tocan: ahí sí
        // significan lo que dicen.
        const tot = filas.reduce(function (t, f) {
            t.goals += f.goals; t.yellow += f.yellow;
            t.red += f.red; t.injuries += f.injuries;
            return t;
        }, { goals: 0, yellow: 0, red: 0, injuries: 0 });
        const totPj = (typeof opts.matchCount === 'number' && isFinite(opts.matchCount))
            ? String(opts.matchCount) : '-';

        const cuerpo = filas.map(function (f) {
            return '<tr>' +
                '<td class="ct-stats-name">' +
                    '<span class="ct-stats-dorsal">' + _eH(f.number || '—') + '</span> ' +
                    _eH(f.alias || 'Sin nombre') +
                '</td>' +
                cel(f.pj) +
                cel(f.minutes) +
                cel(f.goals) +
                cel(f.yellow) +
                cel(f.red) +
                cel(f.injuries) +
            '</tr>';
        }).join('');

        return window.CT_STATS_CSS +
        '<div class="ct-stats-wrap"><table class="ct-stats">' +
            '<caption>Resumen acumulado de la temporada · ' + filas.length + ' jugador' +
                (filas.length === 1 ? '' : 'es') + ' con informes</caption>' +
            '<thead><tr>' +
                '<th class="ct-stats-name">Jugador</th>' +
                '<th title="Partidos jugados">PJ</th>' +
                '<th title="Minutos jugados totales">Min</th>' +
                '<th title="Goles">Goles</th>' +
                // v476 · Los cuadrados grandes van SEGUIDOS en Unicode y es
                // facilisimo pillar el de al lado: &#128997; 🟥 rojo,
                // &#128998; azul, &#128999; naranja, &#129000; 🟨 amarillo,
                // &#129001; 🟩 VERDE. La columna de rojas llevaba 129001, o
                // sea un cuadrado VERDE (reportado en la captura 8567).
                '<th title="Tarjetas amarillas">&#129000; Amarillas</th>' +
                '<th title="Tarjetas rojas">&#128997; Rojas</th>' +
                '<th title="Partidos con lesión">Lesiones</th>' +
            '</tr></thead>' +
            '<tbody>' + cuerpo + '</tbody>' +
            '<tfoot><tr class="ct-stats-total">' +
                '<td class="ct-stats-name">Total equipo</td>' +
                '<td title="Partidos disputados por el equipo">' + totPj + '</td>' +
                '<td title="No se suman: los minutos son de cada jugador">-</td>' +
                '<td>' + tot.goals + '</td>' +
                '<td>' + tot.yellow + '</td>' +
                '<td>' + tot.red + '</td>' +
                '<td>' + tot.injuries + '</td>' +
            '</tr></tfoot>' +
        '</table></div>';
    };
})();

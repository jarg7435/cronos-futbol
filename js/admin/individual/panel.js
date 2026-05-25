// ════════════════════════════════════════════════════════════════════
//  PANEL ADMINISTRADOR INDIVIDUAL (individual) — v4
//  Modal tipo Club Admin · Botón Crear Partido · Secciones unificadas
//  Flujo de registro: Entrenador/Padre → Admin Individual → SA → Confirmado
//  El Admin Individual reenvía solicitudes al SuperAdmin para aprobación
// ════════════════════════════════════════════════════════════════════

// Guardia: SA_CSS puede no estar definido si 16_superadmin.js no cargó aún
// ── saFS local fallback — independiente de 16_superadmin.js ─────
if (typeof window.saFS !== 'function') {
    window.saFS = async function saFS() {
        const fa = window._cronos_auth;
        if (!fa || !fa.db) throw new Error('Firebase no inicializado. Recarga la página.');
        const [fs, fnMod, appMod] = await Promise.all([
            import('https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js'),
            import('https://www.gstatic.com/firebasejs/10.12.2/firebase-functions.js'),
            import('https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js'),
        ]);
        if (!fa._functions) {
            try { fa._functions = fnMod.getFunctions(appMod.getApp()); }
            catch (e) { console.warn('[IndPanel saFS] Functions:', e.message); }
        }
        return {
            db: fa.db, fa: Object.assign({}, fa, { functions: fa._functions }),
            doc: fs.doc, getDoc: fs.getDoc, setDoc: fs.setDoc,
            updateDoc: fs.updateDoc, deleteDoc: fs.deleteDoc,
            collection: fs.collection, query: fs.query,
            where: fs.where, getDocs: fs.getDocs,
            orderBy: fs.orderBy, onSnapshot: fs.onSnapshot,
            serverTimestamp: fs.serverTimestamp,
            httpsCallable: fnMod.httpsCallable,
        };
    };
    console.log('[IndPanel] saFS local fallback activado');
}


if (typeof window.SA_CSS === 'undefined') {
    window.SA_CSS = `<style>
.sa-modal{background:#0d1117!important;border:1px solid rgba(255,255,255,0.1)!important;border-radius:16px!important;max-width:860px!important;width:98vw!important;max-height:92vh!important;display:flex!important;flex-direction:column!important;overflow:hidden!important;font-family:Inter,sans-serif!important;}
.sa-topbar{display:flex;align-items:center;justify-content:space-between;padding:1rem 1.2rem;border-bottom:1px solid rgba(255,255,255,0.1);flex-shrink:0;flex-wrap:wrap;gap:0.5rem;}
.sa-body{flex:1;overflow-y:auto;padding:1rem 1.2rem;-webkit-overflow-scrolling:touch;}
.sa-card{background:rgba(255,255,255,0.04);border:1px solid rgba(255,255,255,0.1);border-radius:10px;padding:0.9rem 1rem;margin-bottom:0.8rem;}
.sa-card-head{display:flex;align-items:center;justify-content:space-between;cursor:pointer;gap:0.5rem;user-select:none;}
.sa-card-title{display:flex;align-items:center;gap:0.5rem;font-weight:700;font-size:0.88rem;color:white;}
.sa-card-body{display:none;padding-top:0.7rem;margin-top:0.5rem;border-top:1px solid rgba(255,255,255,0.1);}
.sa-card.expanded .sa-card-body{display:block;}
.sa-card.expanded .sa-chevron{transform:rotate(0deg);}
.sa-chevron{display:inline-block;transform:rotate(-90deg);transition:transform 0.2s;font-size:0.65rem;}
.sa-badge{display:inline-flex;align-items:center;padding:0.18rem 0.55rem;border-radius:20px;font-size:0.7rem;font-weight:700;background:rgba(88,166,255,0.12);color:#58a6ff;}
.sa-btn{display:inline-flex;align-items:center;gap:0.3rem;padding:0.32rem 0.65rem;border:1px solid rgba(255,255,255,0.1);border-radius:7px;background:rgba(255,255,255,0.04);color:white;font-size:0.78rem;font-weight:600;cursor:pointer;white-space:nowrap;}
.sa-btn:hover{filter:brightness(1.2);}
.sa-input{width:100%;padding:0.5rem 0.75rem;background:rgba(255,255,255,0.06);border:1px solid rgba(255,255,255,0.1);border-radius:8px;color:white;font-size:0.85rem;box-sizing:border-box;outline:none;font-family:Inter,sans-serif;}
.sa-input:focus{border-color:#58a6ff;}
.sa-label{display:block;font-size:0.72rem;color:#8b949e;margin-bottom:0.3rem;font-weight:600;letter-spacing:0.3px;}
.sa-stats{display:grid;grid-template-columns:repeat(auto-fill,minmax(110px,1fr));gap:0.6rem;}
.sa-urow{display:flex;align-items:center;gap:0.5rem;padding:0.45rem 0.3rem;border-bottom:1px solid rgba(255,255,255,0.04);}
.sa-urow:last-child{border-bottom:none;}
.sa-g4{display:grid;grid-template-columns:repeat(auto-fill,minmax(160px,1fr));gap:0.6rem;align-items:start;}
</style>`;
}
if (typeof window.ROLE_META === 'undefined') {
    console.warn('[individual/panel.js] ROLE_META no definido — admin-shared.js no cargó correctamente');
}

// ═══════════════════════════════════════════════════════════════════
// CONSTANTES DE CATEGORÍAS
// ═══════════════════════════════════════════════════════════════════

const IND_CATEGORIES = [
    { id: 'prebenjamin', label: 'Prebenjamín' },
    { id: 'benjamin',    label: 'Benjamín' },
    { id: 'alevin',      label: 'Alevín' },
    { id: 'infantil',    label: 'Infantil' },
    { id: 'cadete',      label: 'Cadete' },
    { id: 'juvenil',     label: 'Juvenil' },
    { id: 'regional',    label: 'Regional' },
];
const IND_SUB_CATS = ['A', 'B', 'C'];

// ═══════════════════════════════════════════════════════════════════
// HELPERS
// ═══════════════════════════════════════════════════════════════════

function _indEsc(s) { return escapeHtml(s || ''); }
function _indEscA(s) { return escapeAttr(s || ''); }

function _indSlotKey(catId, subCat) {
    return `${catId}_${subCat.toLowerCase()}`;
}

function _indCatLabel(catId, subCat) {
    const cat = IND_CATEGORIES.find(c => c.id === catId);
    return cat ? `${cat.label} ${subCat}` : `${catId} ${subCat}`;
}

function _catLabelInd(cat, sub) {
    if (!cat) return '–';
    const map = { prebenjamin:'Prebenjamín', benjamin:'Benjamín', alevin:'Alevín', infantil:'Infantil', cadete:'Cadete', juvenil:'Juvenil', regional:'Regional' };
    let label = map[cat] || map[cat.replace(/_[abc]$/,'')] || cat;
    if (sub) label += ' ' + sub;
    return label;
}

// ═══════════════════════════════════════════════════════════════════
// openIndividualAdminPanel() — Modal tipo Club Admin
// ═══════════════════════════════════════════════════════════════════

async function openIndividualAdminPanel() {
    const me = window._cronosCurrentUser;
    if (!me) {
        if (typeof _saToast === 'function') _saToast('⛔ Usuario no identificado', 3000);
        return;
    }
    const activeRole = me._activeRole || me.role;
    const isSA = me.role === 'superadmin' || me.role === 'admin';

    if (!isSA && activeRole !== 'individual') {
        if (typeof _saToast === 'function') _saToast('⛔ Sin permisos de Administrador Individual', 3000);
        return;
    }

    // ── Firebase init ─────────────────────────────────────────────
    let _fs;
    try {
        _fs = await saFS();
    } catch (err) {
        const _modal = document.getElementById('setup-modal');
        if (_modal) {
            _modal.style.display = 'flex';
            _modal.innerHTML = `<div style="background:#0d1117;border-radius:12px;padding:2rem;color:white;text-align:center;max-width:400px;margin:auto;">
                <div style="font-size:1.5rem;margin-bottom:1rem;">⚠️</div>
                <p style="color:#ff5858;">Error de conexión: ${_indEsc(err.message)}</p>
                <button onclick="document.getElementById('setup-modal').style.display='none'"
                    style="margin-top:1rem;padding:0.5rem 1.2rem;background:rgba(255,88,88,0.15);
                           border:1px solid rgba(255,88,88,0.4);border-radius:7px;color:#ff5858;cursor:pointer;">
                    Cerrar</button>
            </div>`;
        }
        return;
    }
    const { db, doc, getDoc, collection, getDocs, query, where, setDoc, updateDoc, deleteDoc } = _fs;

    // ── Load individual's user document ───────────────────────────
    const uid = me.uid;
    const userSnap = await getDoc(doc(db, 'users', uid));
    if (!userSnap.exists()) {
        if (typeof _saToast === 'function') _saToast('⚠️ Usuario no encontrado en Firestore', 3000);
        return;
    }
    const userData = userSnap.data();

    // ── Load individual entity ──────────────────────────────────
    // FIX: Also check me.clubId (set by SA club picker when SA enters as individual)
    const individualEntityId = userData.individualEntityId || userData.clubId || me.clubId || null;
    let entityData = null;
    if (individualEntityId) {
        // Buscar en clubs (type=individual) primero, luego individuals
        let entitySnap = await getDoc(doc(db, 'clubs', individualEntityId));
        if (entitySnap.exists() && entitySnap.data().type === 'individual') {
            entityData = entitySnap.data();
        } else {
            entitySnap = await getDoc(doc(db, 'individuals', individualEntityId));
            if (entitySnap.exists()) entityData = entitySnap.data();
        }
    }

    // ── Display name ──────────────────────────────────────────────
    const displayName = userData.displayName
        || [userData.firstName, userData.lastName].filter(Boolean).join(' ')
        || me.email;

    // ── Load platform_requests ────────────────────────────────────
    // FIX: Buscar platform_requests por individualOwnerId = entityId Y también por uid del admin
    // para cubrir todos los casos posibles de registro
    const _queryId = individualEntityId || uid;
    let allPrSnap = await getDocs(
        query(collection(db, 'platform_requests'),
            where('individualOwnerId', '==', _queryId)
        )
    ).catch(e => { console.warn('[IndPanel] Error cargando platform_requests por entityId:', e.message); return null; });

    // FIX: Si el _queryId es el entityId, buscar también por uid del admin como fallback
    // (algunos registros antiguos pueden tener individualOwnerId = uid del admin)
    if (_queryId !== uid) {
        const adminPrSnap = await getDocs(
            query(collection(db, 'platform_requests'),
                where('individualOwnerId', '==', uid)
            )
        ).catch(e => { console.warn('[IndPanel] Error cargando platform_requests por uid:', e.message); return null; });
        // Combinar resultados sin duplicar
        if (adminPrSnap && allPrSnap) {
            const existingIds = new Set();
            allPrSnap.forEach(d => existingIds.add(d.id));
            const mergedDocs = [...allPrSnap.docs];
            adminPrSnap.forEach(d => {
                if (!existingIds.has(d.id)) mergedDocs.push(d);
            });
            allPrSnap = { docs: mergedDocs, forEach: (fn) => mergedDocs.forEach(fn) };
        } else if (adminPrSnap && !allPrSnap) {
            allPrSnap = adminPrSnap;
        }
    }

    // FIX: También buscar platform_requests donde el userUid coincida con usuarios del ente
    // y el status sea pending_individual (para capturar solicitudes huérfanas)
    const userPrSnap = await getDocs(
        query(collection(db, 'platform_requests'),
            where('type', '==', 'ind_sub_registration'),
            where('status', '==', 'pending_individual')
        )
    ).catch(e => { console.warn('[IndPanel] Error cargando platform_requests por tipo:', e.message); return null; });
    if (userPrSnap && allPrSnap) {
        const existingIds = new Set();
        allPrSnap.forEach(d => existingIds.add(d.id));
        const mergedDocs = [...allPrSnap.docs];
        userPrSnap.forEach(d => {
            const data = d.data();
            // Solo incluir si el individualOwnerId coincide con nuestra entidad o con nuestro uid
            if (!existingIds.has(d.id) && (data.individualOwnerId === _queryId || data.individualOwnerId === uid)) {
                mergedDocs.push(d);
            }
        });
        allPrSnap = { docs: mergedDocs, forEach: (fn) => mergedDocs.forEach(fn) };
    }

    const pendingAutoReg = [];
    const pendingSAForward = [];

    if (allPrSnap) {
        allPrSnap.forEach(d => {
            const data = { _prId: d.id, ...d.data() };
            if (data.status === 'pending_individual') {
                pendingAutoReg.push(data);
            } else if (data.status === 'pending_sa') {
                pendingSAForward.push(data);
            }
            // NOTA: Ya NO hay estado 'ind_sa_approved' — el SA aprueba y activa directamente
        });
    }

    // ── Load users under this individual ──────────────────────────
    // CRITICAL: Buscar usuarios que pertenezcan a esta entidad individual
    // Debemos buscar por TODOS los campos posibles: individualOwnerId, individualEntityId, clubId
    // porque tras la aprobación del SA, los usuarios confirmados tienen estos campos seteados
    console.log('[IndPanel] Buscando usuarios para entityId:', _queryId, 'uid:', uid);
    const parentsSnap1 = await getDocs(query(collection(db, 'users'),
        where('individualOwnerId', '==', _queryId)
    )).catch(() => null);
    const parentsSnap2 = await getDocs(query(collection(db, 'users'),
        where('individualEntityId', '==', _queryId)
    )).catch(() => null);
    const parentsMap = new Map();
    if (parentsSnap1) parentsSnap1.forEach(d => { if (!parentsMap.has(d.id)) parentsMap.set(d.id, { _id: d.id, ...d.data() }); });
    if (parentsSnap2) parentsSnap2.forEach(d => { if (!parentsMap.has(d.id)) parentsMap.set(d.id, { _id: d.id, ...d.data() }); });
    // FIX: También buscar por clubId = entityId (auth.js sets clubId = entityId for SA panel compatibility)
    // Solo incluir usuarios que tengan rol individual o estén bajo esta entidad
    if (_queryId !== uid) {
        const parentsSnap3 = await getDocs(query(collection(db, 'users'),
            where('clubId', '==', _queryId)
        )).catch(() => null);
        if (parentsSnap3) parentsSnap3.forEach(d => {
            const data = d.data();
            // Solo incluir si tiene algún campo individual o rol que corresponda a esta entidad
            // FIX: No incluir usuarios de club normales — verificar que sea una entidad individual
            if (!parentsMap.has(d.id) && (data.individualEntityId || data.individualOwnerId || data.isIndividual
                || data.role === 'individual' || data.role === 'admin_individual'
                || (data.allRoles||[]).some(r => ['individual','admin_individual','entrenador_individual','padre_individual'].includes(r.role)
                    || r.individualEntityId))) {
                parentsMap.set(d.id, { _id: d.id, ...data });
            }
        });
    }
    // CRITICAL FIX: También buscar por el UID del admin como individualOwnerId
    // (algunas platform_requests y usuarios antiguos usan el UID del admin en vez del entityId)
    if (uid !== _queryId) {
        const parentsSnap4 = await getDocs(query(collection(db, 'users'),
            where('individualOwnerId', '==', uid)
        )).catch(() => null);
        if (parentsSnap4) parentsSnap4.forEach(d => {
            if (!parentsMap.has(d.id)) {
                parentsMap.set(d.id, { _id: d.id, ...d.data() });
            }
        });
        const parentsSnap5 = await getDocs(query(collection(db, 'users'),
            where('individualEntityId', '==', uid)
        )).catch(() => null);
        if (parentsSnap5) parentsSnap5.forEach(d => {
            if (!parentsMap.has(d.id)) {
                parentsMap.set(d.id, { _id: d.id, ...d.data() });
            }
        });
    }
    // FIX: Si el admin individual está en la lista, asegurarse de que tiene el rol correcto
    const adminInMap = parentsMap.get(uid);
    if (adminInMap && adminInMap.role !== 'individual' && adminInMap.role !== 'admin_individual') {
        // El admin individual está en la lista pero su rol principal no es 'individual'
        // Esto puede pasar si se registró con otro rol primero. Actualizar el allRoles
        // para asegurar que tiene el rol de individual.
        console.log('[IndPanel] Admin individual encontrado con rol:', adminInMap.role, '— corrigiendo allRoles');
    }
    const parents = Array.from(parentsMap.values());
    console.log('[IndPanel] Usuarios encontrados:', parents.length,
        '| Entrenadores activos:', parents.filter(u => u.status === 'active' && (u.role === 'user' || (u.allRoles||[]).some(r=>r.role==='user' && r.isAuthorized))).length,
        '| Padres activos:', parents.filter(u => u.status === 'active' && (u.role === 'parent' || (u.allRoles||[]).some(r=>r.role==='parent' && r.isAuthorized))).length);

    const totalPending = pendingAutoReg.length + parents.filter(u => u.status === 'pending_individual' && u.isAuthorized === false).length;

    // ── Counters ──────────────────────────────────────────────────
    // Contar usuarios que hayan sido CONFIRMADOS por el SuperAdmin
    // Un usuario está confirmado cuando su estado principal es 'active' y está autorizado,
    // o bien cuando al menos uno de sus roles en allRoles está activo y autorizado.
    const activeParents = parents.filter(u =>
        (u.status === 'active' && u.isAuthorized === true) ||
        (u.allRoles||[]).some(r => r.isAuthorized && r.status === 'active')
    );
    const blockedParents = parents.filter(u => u.status === 'blocked');
    // FIX: No contar los roles propios del admin (uid === me.uid) como usuarios separados
    const _isAdmin = (u) => (u.uid || u._id) === me.uid;
    // Contar entrenadores basándose en su rol principal o allRoles y su estado de autorización
    // Contar entrenadores basándose en su rol principal o allRoles y su estado de autorización
    const coachCount = activeParents.filter(u =>
        (u.role === 'user' || u.role === 'entrenador_individual'
         || (u.allRoles||[]).some(r => (r.role === 'user' || r.role === 'entrenador_individual') && (r.isAuthorized || u.isAuthorized)))
    ).length;
    // Contar padres basándose en su rol principal o allRoles y su estado de autorización
    const parentCount = activeParents.filter(u =>
        (u.role === 'parent' || u.role === 'parent_individual'
         || (u.allRoles||[]).some(r => (r.role === 'parent' || r.role === 'parent_individual') && (r.isAuthorized || u.isAuthorized)))
    ).length;

    // ── Deduplicate and expand users ──────────────────────────────
    const userMap = new Map();
    parents.forEach(u => {
        const realUid = u.uid || u._id;
        if (!userMap.has(realUid)) {
            userMap.set(realUid, { ...u });
        } else {
            const existing = userMap.get(realUid);
            const merged = [...(existing.allRoles || [])];
            const incoming = u.allRoles || [];
            incoming.forEach(r => {
                if (!merged.some(m => m.role === r.role)) merged.push(r);
            });
            existing.allRoles = merged;
            if (u._id === realUid) {
                const preservedRoles = existing.allRoles;
                Object.assign(existing, u);
                existing.allRoles = preservedRoles;
            }
        }
    });
    const finalUsers = Array.from(userMap.values());

    const expandedUsers = [];
    finalUsers.filter(u => u.status !== 'removed').forEach(u => {
        let roles = u.allRoles || [];
        if (roles.length === 0) {
            roles = [{ role: u.role, isAuthorized: u.isAuthorized, status: u.status,
                category: u.category || u.categoryLabel, subcategory: u.subcategory || u.subCategory }];
        }

        // FIX: Deduplicar roles (mismo role + category + subcategory)
        const _seenRoleKey = new Set();
        const uniqueRoles = roles.filter(r => {
            if (r.status === 'rejected' || r.status === 'removed') return false;
            const key = (r.role || '') + '|' + (r.category || '') + '|' + (r.subcategory || r.subCategory || '');
            if (_seenRoleKey.has(key)) return false;
            _seenRoleKey.add(key);
            return true;
        });

        // Expand all unique roles for display in the table, including the admin's secondary roles
        const rolesToExpand = uniqueRoles;

        rolesToExpand.forEach(r => {
            expandedUsers.push({ ...u, _activeRoleData: r });
        });
    });

    const sortedUsers = expandedUsers.sort((a, b) => {
        const dateA = a.createdAt?.seconds || a.authorizedAt || 0;
        const dateB = b.createdAt?.seconds || b.authorizedAt || 0;
        return dateA - dateB;
    });

    // ── Render modal ──────────────────────────────────────────────
    let setupModal = document.getElementById('setup-modal');
    if (!setupModal) {
        setupModal = document.createElement('div');
        setupModal.id = 'setup-modal';
        setupModal.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.75);display:flex;align-items:center;justify-content:center;z-index:9999;padding:1rem;';
        document.body.appendChild(setupModal);
    }
    setupModal.style.display = 'flex';

    const _eH = _indEsc;
    const _eA = (s) => _indEscA(s).replace(/\\/g, '\\\\').replace(/'/g, "\\'");

    // ── Build unified user table ──────────────────────────────────
    const userTableRows = sortedUsers.map(u => {
        const r = u._activeRoleData;
        const roleMeta = window.ROLE_META[r.role] || { label: r.role, icon: '👤', color: '#8b949e' };
        let name = u.firstName || u.displayName || u.email.split('@')[0];
        name = name.split(' ')[0];
        let regDate = '–';
        if (u.createdAt) {
            let d;
            if (u.createdAt.toDate) d = u.createdAt.toDate();
            else if (typeof u.createdAt === 'number') d = new Date(u.createdAt);
            else if (u.createdAt.seconds) d = new Date(u.createdAt.seconds * 1000);
            else d = new Date(u.createdAt); // Fallback para strings ISO
            
            if (d instanceof Date && !isNaN(d)) regDate = d.toLocaleDateString();
        } else if (u.authorizedAt) {
            const d = new Date(u.authorizedAt);
            if (d instanceof Date && !isNaN(d)) regDate = d.toLocaleDateString();
        }
        const catLabel = r.category || '–';
        const subLabel = r.subcategory || '–';
        const euid = _eA(u._id);
        const email = _eA(u.email || u._id);

        return `
        <tr style="border-bottom:1px solid rgba(255,255,255,0.05);transition:background 0.2s;" onmouseover="this.style.background='rgba(255,255,255,0.02)'" onmouseout="this.style.background='transparent'">
            <td style="padding:0.8rem 0.7rem;">
                <div style="font-weight:600;color:white;">${_eH(name)}</div>
                <div style="font-size:0.68rem;color:${roleMeta.color};">${roleMeta.icon} ${roleMeta.label}</div>
                ${!r.isAuthorized || r.status === 'pending_individual' ? '<div style="font-size:0.62rem;color:#ffa500;">⏳ Pendiente</div>' : ''}
            </td>
            <td style="padding:0.8rem 0.7rem;font-size:0.8rem;color:#8b949e;">${_eH(u.email)}</td>
            <td style="padding:0.8rem 0.7rem;font-size:0.8rem;color:#8b949e;">${regDate}</td>
            <td style="padding:0.8rem 0.7rem;font-size:0.8rem;color:#79c0ff;font-weight:600;">${_eH(_catLabelInd(catLabel, ''))}</td>
            <td style="padding:0.8rem 0.7rem;font-size:0.8rem;color:#d2a8ff;font-weight:600;">${_eH(subLabel)}</td>
            <td style="padding:0.8rem 0.7rem;text-align:right;">
                <div style="display:flex;gap:0.4rem;justify-content:flex-end;">
                    <button class="sa-btn" onclick="indEditCategory('${euid}','${email}')" style="padding:0.25rem 0.5rem;color:#79c0ff;border-color:rgba(121,192,255,0.2);">✏️</button>
                    <button class="sa-btn" onclick="indDeleteParent('${euid}','${email}')" style="padding:0.25rem 0.5rem;color:#ff5858;border-color:rgba(255,88,88,0.2);">✕</button>
                </div>
            </td>
        </tr>`;
    }).join('');

    const unifiedUserTable = `
    <div style="background:rgba(255,255,255,0.03);border:1px solid rgba(255,255,255,0.08);border-radius:12px;overflow:hidden;margin-bottom:1.5rem;">
        <div style="padding:0.7rem 1rem;background:rgba(255,255,255,0.04);border-bottom:1px solid rgba(255,255,255,0.08);display:flex;align-items:center;justify-content:space-between;">
            <div style="font-size:0.85rem;font-weight:700;color:white;display:flex;align-items:center;gap:0.5rem;">
                👥 Usuarios del Administrador Individual
                <span class="sa-badge" style="background:rgba(121,192,255,0.12);color:#79c0ff;">${sortedUsers.length}</span>
            </div>
            <button class="sa-btn" onclick="openIndividualAdminPanel()" style="font-size:0.72rem;color:#79c0ff;border-color:rgba(121,192,255,0.3);background:rgba(121,192,255,0.07);">🔄</button>
        </div>
        <table style="width:100%;border-collapse:collapse;text-align:left;">
            <thead>
                <tr style="background:rgba(255,255,255,0.05);border-bottom:1px solid rgba(255,255,255,0.1);">
                    <th style="padding:0.8rem 0.7rem;font-size:0.75rem;font-weight:700;color:#79c0ff;text-transform:uppercase;letter-spacing:1px;">Nombre</th>
                    <th style="padding:0.8rem 0.7rem;font-size:0.75rem;font-weight:700;color:#79c0ff;text-transform:uppercase;letter-spacing:1px;">Email</th>
                    <th style="padding:0.8rem 0.7rem;font-size:0.75rem;font-weight:700;color:#79c0ff;text-transform:uppercase;letter-spacing:1px;">Registro</th>
                    <th style="padding:0.8rem 0.7rem;font-size:0.75rem;font-weight:700;color:#79c0ff;text-transform:uppercase;letter-spacing:1px;">Categoría</th>
                    <th style="padding:0.8rem 0.7rem;font-size:0.75rem;font-weight:700;color:#79c0ff;text-transform:uppercase;letter-spacing:1px;">Subcat.</th>
                    <th style="padding:0.8rem 0.7rem;text-align:right;"></th>
                </tr>
            </thead>
            <tbody>
                ${userTableRows || '<tr><td colspan="6" style="padding:2rem;text-align:center;color:#8b949e;">No hay usuarios registrados.</td></tr>'}
            </tbody>
        </table>
    </div>`;

    // ── Stats cards ───────────────────────────────────────────────
    const statsHTML = `
    <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(130px,1fr));gap:0.6rem;margin-bottom:1.5rem;">
        <div style="background:rgba(255,255,255,0.04);border:1px solid rgba(255,255,255,0.1);border-radius:9px;padding:0.7rem;text-align:center;">
            <div style="font-size:1.3rem;font-weight:800;color:#3fb950;">${coachCount}</div>
            <div style="font-size:0.65rem;color:#8b949e;margin-top:0.1rem;">⚽ Entrenadores</div>
        </div>
        <div style="background:rgba(255,255,255,0.04);border:1px solid rgba(255,255,255,0.1);border-radius:9px;padding:0.7rem;text-align:center;">
            <div style="font-size:1.3rem;font-weight:800;color:#79c0ff;">${parentCount}</div>
            <div style="font-size:0.65rem;color:#8b949e;margin-top:0.1rem;">👨‍👩‍👧 Padres / Madres</div>
        </div>
        <div style="background:rgba(255,255,255,0.04);border:1px solid rgba(255,255,255,0.1);border-radius:9px;padding:0.7rem;text-align:center;">
            <div style="font-size:1.3rem;font-weight:800;color:#ffa500;">${totalPending}</div>
            <div style="font-size:0.65rem;color:#8b949e;margin-top:0.1rem;">⏳ Pendientes</div>
        </div>
        <div style="background:rgba(255,255,255,0.04);border:1px solid rgba(255,255,255,0.1);border-radius:9px;padding:0.7rem;text-align:center;">
            <div style="font-size:1.3rem;font-weight:800;color:#ff5858;">${blockedParents.length}</div>
            <div style="font-size:0.65rem;color:#8b949e;margin-top:0.1rem;">🔒 Bloqueados</div>
        </div>
    </div>`;

    // ── Section: Solicitudes enviadas al SA (transparencia) ───────
    let saForwardHTML = '';
    if (pendingSAForward.length) {
        saForwardHTML = `
        <div style="background:rgba(88,166,255,0.08);border:1px solid rgba(88,166,255,0.3);border-radius:12px;padding:1rem;margin-bottom:1.5rem;">
            <h3 style="margin:0 0 0.8rem;font-size:0.85rem;color:#58a6ff;display:flex;align-items:center;gap:0.5rem;">
                📤 Solicitudes enviadas al SuperAdmin
                <span style="background:#58a6ff;color:white;padding:2px 8px;border-radius:10px;font-size:0.7rem;">${pendingSAForward.length}</span>
            </h3>
            ${pendingSAForward.map(u => {
                const role = u.requestedRole || 'parent';
                const roleLabel = (window.ROLE_META[role] || {}).label || (role === 'user' ? 'Entrenador' : 'Padre/Madre/Tutor');
                return `<div style="font-size:0.8rem;color:white;padding:5px 0;border-bottom:1px solid rgba(255,255,255,0.05);">
                    • <strong>${_eH(u.userEmail || u.requestedEmail || '')}</strong> solicitó ser <strong>${roleLabel}</strong>.
                    <span style="color:#8b949e;font-size:0.72rem;display:block;margin-top:2px;">⏳ Esperando que el SuperAdmin apruebe la solicitud.</span>
                </div>`;
            }).join('')}
        </div>`;
    }

    // ── Section: Solicitudes de registro pendientes de reenvío ────
    let pendingRegHTML = '';
    if (pendingAutoReg.length) {
        pendingRegHTML = `
        <div style="background:rgba(255,165,0,0.06);border:1px solid rgba(255,165,0,0.25);border-radius:10px;padding:1rem;margin-bottom:1.5rem;">
            <h3 style="font-size:0.85rem;margin:0 0 0.8rem;color:#ffa500;display:flex;align-items:center;gap:0.5rem;">
                📨 Solicitudes de Registro (${pendingAutoReg.length})
            </h3>
            <p style="font-size:0.73rem;color:#8b949e;margin:0 0 0.7rem;padding:0.4rem 0.6rem;background:rgba(255,165,0,0.05);border-radius:6px;border:1px solid rgba(255,165,0,0.15);">
                ℹ️ Estos usuarios se han registrado y esperan que reenvíes su solicitud al SuperAdmin.
            </p>
            ${pendingAutoReg.map(u => {
                const role = u.requestedRole || 'parent';
                // Use requestedRoleLabel if available (from auth.js ind_sub_registration), fallback to ROLE_META
                const roleLabel = u.requestedRoleLabel || (window.ROLE_META[role] || {}).label || (role === 'user' ? 'Entrenador' : 'Padre/Madre/Tutor');
                const roleIcon = role === 'user' ? '⚽' : '👨‍👩‍👧';
                const catBadge = u.categoryLabel || u.requestedCategoryLabel
                    ? `<span style="font-size:0.68rem;color:#d2a8ff;background:rgba(210,168,255,0.1);border:1px solid rgba(210,168,255,0.2);border-radius:4px;padding:1px 6px;margin-left:0.3rem;">${_eH(u.categoryLabel || u.requestedCategoryLabel || '')}</span>`
                    : '';
                const prId = _eA(u._prId || '');
                const escEmail = _eA(u.userEmail || '');
                const escUid = _eA(u.userUid || '');
                return `<div style="background:rgba(0,0,0,0.2);border-radius:8px;padding:0.7rem;margin-bottom:0.5rem;border:1px solid rgba(255,165,0,0.15);display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:0.5rem;">
                    <div style="min-width:0;flex:1;">
                        <div style="font-size:0.85rem;font-weight:600;word-break:break-all;">${_eH(u.userEmail || u.userName || '')}</div>
                        <div style="font-size:0.72rem;color:var(--text-muted);margin-top:2px;">${roleIcon} ${roleLabel}${catBadge}</div>
                    </div>
                    <div style="display:flex;gap:0.4rem;flex-shrink:0;">
                        <button onclick="indForwardToSA('${prId}','${escUid}','${role}','${escEmail}','${_eA(u.categoryLabel||u.requestedCategoryLabel||'')}')" class="sa-btn" style="color:#58a6ff;border-color:rgba(88,166,255,0.3);background:rgba(88,166,255,0.08);font-size:0.75rem;">📤 Reenviar al SA</button>
                        <button onclick="indRejectRequest('${prId}','${escUid}','${escEmail}')" class="sa-btn" style="color:#ff5858;border-color:rgba(255,88,88,0.3);background:rgba(255,88,88,0.08);font-size:0.75rem;">✕</button>
                    </div>
                </div>`;
            }).join('')}
        </div>`;
    }

    // ── Section: Solicitar nuevo usuario ──────────────────────────
    const catOptions = IND_CATEGORIES.flatMap(cat =>
        IND_SUB_CATS.map(sub => `<option value="${_indSlotKey(cat.id, sub)}">${cat.label} ${sub}</option>`)
    ).join('');

    const requestFormHTML = `
    <div style="background:rgba(255,255,255,0.04);border:1px solid rgba(88,166,255,0.25);border-radius:10px;padding:1rem;margin-bottom:1.5rem;">
        <div style="font-weight:700;color:#58a6ff;margin-bottom:0.4rem;font-size:0.9rem;">
            📩 Solicitar nuevo usuario al SuperAdmin</div>
        <div style="font-size:0.75rem;color:#8b949e;margin-bottom:0.8rem;
                    padding:0.5rem 0.7rem;background:rgba(88,166,255,0.05);
                    border:1px solid rgba(88,166,255,0.15);border-radius:8px;line-height:1.5;">
            <strong style="color:#58a6ff;">Flujo de solicitud:</strong>
            1️⃣ Tú solicitas aquí → 2️⃣ SuperAdmin aprueba → 3️⃣ El usuario se registra → 4️⃣ Queda activo automáticamente
        </div>
        <div class="sa-g4" style="margin-bottom:0.6rem;">
            <div><label class="sa-label">Email del padre / tutor *</label>
                <input class="sa-input" id="ind-req-email" type="email" placeholder="padre@email.com"></div>
            <div><label class="sa-label">Nombre completo</label>
                <input class="sa-input" id="ind-req-name" placeholder="Nombre y apellidos"></div>
        </div>
        <div class="sa-g4" style="margin-bottom:0.6rem;">
            <div><label class="sa-label">Categoría *</label>
                <select class="sa-input" id="ind-req-category">${catOptions}</select></div>
            <div><label class="sa-label">Nº Dorsal del jugador *</label>
                <input class="sa-input" id="ind-req-dorsal" type="number" placeholder="ej: 7" min="1" max="99"></div>
        </div>
        <div class="sa-g4" style="margin-bottom:0.6rem;">
            <div><label class="sa-label">Alias del jugador</label>
                <input class="sa-input" id="ind-req-alias" placeholder="ej: García"></div>
            <div><label class="sa-label">WhatsApp del padre (sin +)</label>
                <input class="sa-input" id="ind-req-wa" type="tel" placeholder="ej: 34612345678"></div>
        </div>
        <div style="display:flex;justify-content:flex-end;gap:0.5rem;margin-top:0.8rem;">
            <button onclick="indSolicitarPadre()" class="sa-btn"
                style="color:#58a6ff;border-color:rgba(88,166,255,0.4);background:rgba(88,166,255,0.1);font-weight:700;padding:0.45rem 1.2rem;">
                📩 Enviar solicitud</button>
        </div>
        <div id="ind-req-msg" style="font-size:0.78rem;margin-top:0.4rem;min-height:1.2rem;color:#3fb950;"></div>
    </div>`;

    // ── Info box ──────────────────────────────────────────────────
    const infoHTML = `
    <div style="background:rgba(121,192,255,0.05);border:1px solid rgba(121,192,255,0.15);border-radius:8px;padding:0.7rem;font-size:0.75rem;color:#8b949e;line-height:1.5;margin-bottom:1rem;">
        ℹ️ <strong style="color:#79c0ff;">Flujo de registro del Ente Individual:</strong><br>
        1️⃣ El <strong>Administrador Individual</strong> se registra → solicitud va <strong>directamente al SuperAdmin</strong> → SA confirma → queda registrado.<br>
        2️⃣ El <strong>Entrenador/Padre</strong> se registra eligiendo tu entidad individual del desplegable → su solicitud aparece aquí en <strong>📨 Solicitudes</strong>.<br>
        3️⃣ Tú reenvías la solicitud al <strong>SuperAdmin</strong> → SA aprueba → el usuario queda <strong>registrado y activo</strong>.<br>
        4️⃣ Los iconos de rol solo aparecen <strong>después de estar registrados y confirmados</strong>.
    </div>`;

    // ── Assemble full modal ───────────────────────────────────────
    setupModal.innerHTML = SA_CSS + `
    <div class="modal-content sa-modal">
      <div class="sa-topbar">
        <div>
          <div style="font-size:1.15rem;font-weight:700;">👤 ${_eH(displayName)}</div>
          <div style="font-size:0.76rem;color:var(--text-muted);margin-top:0.1rem;">Panel del Administrador Individual</div>
        </div>
        <div style="display:flex;gap:0.7rem;flex-wrap:wrap;">
          <button onclick="(function(){ const m=document.getElementById('setup-modal'); if(m) m.style.display='none'; if(typeof openSetupModal==='function') openSetupModal(); })()"
              style="padding:0.45rem 1rem;background:rgba(63,185,80,0.15);
                     border:1px solid rgba(63,185,80,0.5);border-radius:10px;
                     color:#3fb950;font-size:0.85rem;font-weight:700;cursor:pointer;">
              ⚽ Crear Partido</button>
          <button onclick="indNotifySuperAdmin()"
              style="padding:0.45rem 1rem;background:rgba(88,166,255,0.15);
                     border:1px solid rgba(88,166,255,0.4);border-radius:10px;
                     color:var(--primary);font-size:0.75rem;font-weight:700;cursor:pointer;">
              📡 Transmitir al SuperAdmin</button>
          <button onclick="if(typeof showRoleSelector==='function') showRoleSelector();"
              style="padding:0.45rem 1rem;background:rgba(255,215,0,0.1);
                     border:1px solid rgba(255,215,0,0.3);border-radius:10px;
                     color:#ffd700;font-size:0.75rem;font-weight:700;cursor:pointer;">
              ⇄ Cambiar Rol</button>
          <button onclick="if(typeof cerrarSesion==='function')cerrarSesion();else if(typeof logoutUser==='function')logoutUser();"
              style="padding:0.45rem 1rem;background:rgba(255,88,88,0.15);
                     border:1px solid rgba(255,88,88,0.4);border-radius:10px;
                     color:#ff5858;font-size:0.75rem;font-weight:700;cursor:pointer;">
              🚪 SALIR</button>
        </div>
      </div>

      <div class="sa-body">
        ${statsHTML}
        ${saForwardHTML}
        ${pendingRegHTML}
        ${unifiedUserTable}
        ${requestFormHTML}
        ${infoHTML}

        <!-- ── SECCIÓN FACTURACIÓN ── -->
        <div style="margin-top:1.5rem;border-top:1px solid rgba(255,255,255,0.08);padding-top:1.2rem;">
          <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:0.8rem;flex-wrap:wrap;gap:0.5rem;">
            <div style="font-size:0.88rem;font-weight:700;color:white;display:flex;align-items:center;gap:0.4rem;">
              💳 Mi suscripción
            </div>
            <button onclick="billIndividualView('ind-billing-container')"
                style="padding:0.3rem 0.75rem;background:rgba(88,166,255,0.1);border:1px solid rgba(88,166,255,0.3);
                       border-radius:7px;color:#58a6ff;font-size:0.75rem;font-weight:600;cursor:pointer;">
                🔄 Actualizar
            </button>
          </div>
          <div id="ind-billing-container" style="min-height:60px;">
            <div style="text-align:center;color:#8b949e;font-size:0.82rem;padding:1rem;">
              <button onclick="if(typeof billIndividualView==='function')billIndividualView('ind-billing-container')"
                  style="padding:0.4rem 1rem;background:rgba(88,166,255,0.1);border:1px solid rgba(88,166,255,0.3);
                         border-radius:7px;color:#58a6ff;font-size:0.78rem;cursor:pointer;">
                  📊 Ver mi plan y facturas
              </button>
            </div>
          </div>
        </div>

      </div>
    </div>`;

    // ── Store data globally for action functions ──────────────────
    window._indData = {
        uid, userData, parents,
        pendingAutoReg, pendingSAForward, displayName, me
    };
}

// ════════════════════════════════════════════════════════════════════
// HELPERS DE MÓDULO — accesibles desde todas las funciones
// ════════════════════════════════════════════════════════════════════

function _matchCat(u, catId, subCat) {
    if (!u.category && !u.categoryLabel) return false;
    const catFilter = catId + '_' + subCat.toLowerCase();
    if (u.category === catId && (u.subCategory||'').toUpperCase() === subCat.toUpperCase()) return true;
    if (u.category === catFilter) return true;
    const lbl = (u.categoryLabel || '').toLowerCase();
    if (lbl.includes(catId) && lbl.includes(subCat.toLowerCase())) return true;
    if ((u.allRoles||[]).some(r =>
        (r.category === catId && (r.subCategory||'').toUpperCase() === subCat.toUpperCase()) ||
        r.category === catFilter ||
        ((r.categoryLabel||'').toLowerCase().includes(catId) && (r.categoryLabel||'').toLowerCase().includes(subCat.toLowerCase()))
    )) return true;
    return false;
}

function _isActiveParent(u) {
    const isParent = u.role === 'parent' || u.role === 'parent_individual'
        || (u.allRoles||[]).some(r => r.role === 'parent' || r.role === 'parent_individual');
    const isCoach  = u.role === 'user' || u.role === 'entrenador_individual'
        || (u.allRoles||[]).some(r => r.role === 'user' || r.role === 'entrenador_individual');
    return (isParent || isCoach) &&
        u.isAuthorized !== false &&
        u.status !== 'removed' && u.status !== 'rejected';
}

// ═══════════════════════════════════════════════════════════════════
// indNotifySuperAdmin() — Notificar al SuperAdmin
// ═══════════════════════════════════════════════════════════════════

window.indNotifySuperAdmin = async function indNotifySuperAdmin() {
    const d = window._indData;
    if (!d) return;
    const { me, displayName, userData } = d;
    const _entityId = userData?.individualEntityId || me.uid;
    if (typeof _saShowSpinner === 'function') _saShowSpinner('Enviando notificación…');
    try {
        const { db, doc, setDoc } = await saFS();
        await setDoc(doc(db, 'platform_requests', `ind_notify_${_entityId}_${Date.now()}`), {
            type: 'individual_notification',
            individualOwnerId: _entityId,
            individualEmail: me.email,
            individualName: displayName || me.email,
            message: `El administrador individual ${displayName || me.email} solicita atención del SuperAdmin.`,
            status: 'unread',
            createdAt: new Date().toISOString(),
        });
        if (typeof _saHideSpinner === 'function') _saHideSpinner();
        if (typeof _saToast === 'function') _saToast('✅ Notificación enviada al SuperAdmin', 4000);
    } catch (e) {
        if (typeof _saHideSpinner === 'function') _saHideSpinner();
        if (typeof _saToast === 'function') _saToast('❌ Error: ' + e.message, 4000);
    }
};

// ═══════════════════════════════════════════════════════════════════
// indForwardToSA() — Forward pending registration to SuperAdmin
// ═══════════════════════════════════════════════════════════════════

window.indForwardToSA = async function indForwardToSA(prId, userUid, role, email, categoryLabel) {
    const d = window._indData;
    if (!d) return;
    const { me } = d;

    const isIndSub = role === 'user' || role === 'parent';
    const roleLabel = isIndSub
        ? (role === 'user' ? 'Entrenador Individual' : 'Padre/Madre/Tutor Individual')
        : (window.ROLE_META[role] || {}).label || role;
    if (!confirm('¿Enviar solicitud al SuperAdmin para ' + email + '?\n\nRol: ' + roleLabel + (categoryLabel ? ' · ' + categoryLabel : '') + '\n\nEl SuperAdmin deberá aprobarla.')) return;
    if (typeof _saShowSpinner === 'function') _saShowSpinner('Enviando al SuperAdmin…');
    try {
        const { db, doc, updateDoc, getDoc } = await saFS();
        // Read the existing platform_request to preserve all data
        const prSnap = await getDoc(doc(db, 'platform_requests', prId)).catch(() => null);
        const existingData = prSnap && prSnap.exists() ? prSnap.data() : {};

        const updateData = {
            status:          'pending_sa',
            forwardedAt:     new Date().toISOString(),
            forwardedBy:     me.uid,
            forwardedByEmail: me.email,
        };
        // CRITICAL: Ensure requestedRole and requestedRoleLabel are correct for sub-users
        // This prevents the SA from seeing "Administrador Individual" instead of "Entrenador/Padre"
        if (isIndSub && existingData.requestedRole !== role) {
            updateData.requestedRole = role;
            updateData.requestedRoleLabel = role === 'user' ? 'Entrenador Individual' : 'Padre/Madre/Tutor Individual';
        }
        // Ensure the type is preserved as ind_sub_registration
        if (isIndSub && existingData.type !== 'ind_sub_registration') {
            updateData.type = 'ind_sub_registration';
        }
        // Ensure individualOwnerId is set
        if (!existingData.individualOwnerId && d.userData?.individualEntityId) {
            updateData.individualOwnerId = d.userData.individualEntityId;
        }
        // CRITICAL FIX: Also ensure clubId is set on the platform_request
        // so the SA approval code can properly link the user to the entity
        if (!existingData.clubId && d.userData?.individualEntityId) {
            updateData.clubId = d.userData.individualEntityId;
        }
        // CRITICAL FIX: Ensure individualEntityId is set on the platform_request
        if (!existingData.individualEntityId && d.userData?.individualEntityId) {
            updateData.individualEntityId = d.userData.individualEntityId;
        }

        await updateDoc(doc(db, 'platform_requests', prId), updateData);
        // CRITICAL FIX: También actualizar el estado del usuario a 'pending_sa'
        // para que si intenta iniciar sesión, vea el mensaje correcto:
        // "Tu solicitud fue reenviada al SuperAdmin. Espera la confirmación."
        // en vez de "El Administrador Individual debe revisarla"
        if (userUid) {
            try {
                const _userUpdateData = { status: 'pending_sa' };
                // También asegurarse de que allRoles refleje el estado correcto
                const _userSnap = await getDoc(doc(db, 'users', userUid)).catch(() => null);
                if (_userSnap && _userSnap.exists()) {
                    const _userData = _userSnap.data();
                    const _updatedAllRoles = (_userData.allRoles || []).map(r => {
                        if (r.role === role && r.status === 'pending_individual') {
                            return { ...r, status: 'pending_sa' };
                        }
                        return r;
                    });
                    _userUpdateData.allRoles = _updatedAllRoles;
                }
                await updateDoc(doc(db, 'users', userUid), _userUpdateData);
            } catch (userUpdateErr) {
                console.warn('[indForwardToSA] Error actualizando estado del usuario:', userUpdateErr.message);
            }
        }
        if (typeof _saHideSpinner === 'function') _saHideSpinner();
        if (typeof _saToast === 'function') _saToast('✅ Solicitud enviada al SuperAdmin para ' + email, 4000);
        openIndividualAdminPanel();
    } catch (e) {
        if (typeof _saHideSpinner === 'function') _saHideSpinner();
        if (typeof _saToast === 'function') _saToast('❌ Error: ' + e.message, 4000);
        console.error('[indForwardToSA]', e);
    }
};

window.indRejectRequest = async function indRejectRequest(prId, userUid, email) {
    if (!confirm('¿Rechazar la solicitud de ' + (email || 'este usuario') + '?')) return;
    try {
        const { db, doc, updateDoc, deleteDoc } = await saFS();
        if (prId) await deleteDoc(doc(db, 'platform_requests', prId)).catch(()=>{});
        if (userUid) {
            await updateDoc(doc(db, 'users', userUid), { status: 'rejected', isAuthorized: false }).catch(()=>{});
        }
        if (typeof _saToast === 'function') _saToast('✕ Solicitud rechazada', 3000);
        openIndividualAdminPanel();
    } catch(e) {
        if (typeof _saToast === 'function') _saToast('❌ Error: ' + e.message, 4000);
    }
};


window.indConfirmAccess = async function indConfirmAccess(parentUid, email) {
    if (!confirm(`¿Confirmar acceso definitivo a ${email}?`)) return;
    if (typeof _saShowSpinner === 'function') _saShowSpinner('Confirmando acceso…');
    try {
        const { db, doc, updateDoc, getDoc } = await saFS();
        const me = window._cronosCurrentUser;
        const targetDocRef = doc(db, 'users', parentUid);
        const targetSnap   = await getDoc(targetDocRef);
        let updateData = {
            isAuthorized: true,
            status: 'active',
            authorizedAt: new Date().toISOString(),
            authorizedBy: me.uid,
        };

        if (targetSnap.exists()) {
            const data = targetSnap.data();
            const roleInAll = (data.allRoles || []).find(r => r.role === 'parent' || r.role === 'user');
            const cat = (roleInAll && roleInAll.category) || data.requestedCategory || data.categoryLabel;
            const sub = (roleInAll && roleInAll.subcategory) || data.requestedSubcat || data.subCategory;

            if (cat) {
                updateData.category      = cat;
                updateData.categoryLabel = (roleInAll && roleInAll.categoryLabel) || (typeof _indCatLabel==='function' ? _indCatLabel(cat.split('_')[0], cat.split('_')[1]||'') : cat);
                if (sub) {
                    updateData.subcategory = sub;
                    updateData.subCategory = sub;
                }
            }

            if (data.allRoles) {
                updateData.allRoles = data.allRoles.map(r => {
                    if (r.role === 'parent' || r.role === 'user') return { ...r, isAuthorized: true, status: 'active' };
                    return r;
                });
            }
        }

        await updateDoc(targetDocRef, updateData);
        if (typeof _saHideSpinner === 'function') _saHideSpinner();
        if (typeof _saToast === 'function') _saToast(`✅ ${email} tiene acceso completo a la app.`, 4000);
        openIndividualAdminPanel();
    } catch (e) {
        if (typeof _saHideSpinner === 'function') _saHideSpinner();
        if (typeof _saToast === 'function') _saToast('❌ Error: ' + e.message, 4000);
        console.error('[indConfirmAccess]', e);
    }
};

// ═══════════════════════════════════════════════════════════════════
// indSetParentStatus() — Block / Activate a parent
// ═══════════════════════════════════════════════════════════════════

window.indSetParentStatus = async function indSetParentStatus(parentUid, email, newStatus) {
    const actionLabel = newStatus === 'blocked' ? 'bloquear' : 'activar';
    if (!confirm(`¿${actionLabel} a ${email}?`)) return;
    if (typeof _saShowSpinner === 'function') _saShowSpinner('Procesando…');
    try {
        const { db, doc, updateDoc } = await saFS();
        if (newStatus === 'blocked') {
            await updateDoc(doc(db, 'users', parentUid), {
                status: 'blocked',
                isAuthorized: false,
                blockedAt: new Date().toISOString(),
                blockedBy: window._cronosCurrentUser?.uid || 'individual',
            });
        } else {
            await updateDoc(doc(db, 'users', parentUid), {
                status: 'active',
                isAuthorized: true,
                authorizedAt: new Date().toISOString(),
                authorizedBy: window._cronosCurrentUser?.uid || 'individual',
            });
        }
        if (typeof _saHideSpinner === 'function') _saHideSpinner();
        if (typeof _saToast === 'function') _saToast(`✅ ${email} ${newStatus === 'blocked' ? 'bloqueado' : 'activado'}.`, 3000);
        openIndividualAdminPanel();
    } catch (e) {
        if (typeof _saHideSpinner === 'function') _saHideSpinner();
        if (typeof _saToast === 'function') _saToast('❌ Error: ' + e.message, 4000);
        console.error('[indSetParentStatus]', e);
    }
};

// ═══════════════════════════════════════════════════════════════════
// indDeleteParent() — Delete parent completely from DB (email reuse)
// ═══════════════════════════════════════════════════════════════════

window.indDeleteParent = async function indDeleteParent(parentUid, email) {
    if (!confirm(`⚠️ ¿ELIMINAR completamente a ${email}?\n\nEsta acción es irreversible.\nEl usuario será borrado de la base de datos y su email podrá reutilizarse.`)) return;
    if (typeof _saShowSpinner === 'function') _saShowSpinner('Eliminando usuario…');
    try {
        const { db, fa, doc, getDoc, deleteDoc, collection, getDocs, query, where, updateDoc, httpsCallable } = await saFS();

        // FIX: Read user data before deletion to check if they're an admin and get entity info
        const userSnap = await getDoc(doc(db, 'users', parentUid)).catch(() => null);
        const uData = userSnap && userSnap.exists() ? userSnap.data() : {};
        const _entityId = uData.individualEntityId || uData.clubId || null;
        const _isAdminIndiv = uData.role === 'individual' || uData.role === 'admin_individual'
            || (uData.allRoles||[]).some(r => (r.role === 'individual' || r.role === 'admin_individual') && r.isAuthorized);

        // Try to delete from Firebase Auth
        if (httpsCallable && fa && fa.functions) {
            try {
                await httpsCallable(fa.functions, 'deleteAuthUser')({ uid: parentUid, email });
            } catch(cfErr) {
                console.warn('[indDeleteParent] deleteAuthUser falló (no bloqueante):', cfErr.message);
            }
        }

        // Delete platform_requests for this user
        try {
            const prSnaps = await getDocs(query(collection(db, 'platform_requests'), where('userUid', '==', parentUid)));
            const prArr = []; prSnaps.forEach(d => prArr.push(d));
            for (const pr of prArr) {
                try { await deleteDoc(doc(db, 'platform_requests', pr.id)); } catch (_) {}
            }
        } catch (_) {}
        try {
            const prSnaps2 = await getDocs(query(collection(db, 'platform_requests'), where('requestedEmail', '==', email)));
            const prArr2 = []; prSnaps2.forEach(d => prArr2.push(d));
            for (const pr2 of prArr2) {
                try { await deleteDoc(doc(db, 'platform_requests', pr2.id)); } catch (_) {}
            }
        } catch (_) {}

        // Delete from Firestore completely (allows email reuse)
        await deleteDoc(doc(db, 'users', parentUid));

        // FIX: If the deleted user was an individual admin, update the entity document
        if (_isAdminIndiv && _entityId) {
            try {
                const entSnap = await getDoc(doc(db, 'clubs', _entityId));
                if (entSnap.exists() && entSnap.data().type === 'individual') {
                    // Check if there are other individual admins remaining
                    const remainingAdmins = await getDocs(query(collection(db, 'users'),
                        where('individualEntityId', '==', _entityId),
                        where('role', 'in', ['individual', 'admin_individual'])
                    )).catch(() => ({forEach:()=>{}}));
                    let _hasOtherAdmin = false;
                    remainingAdmins.forEach(function(d) {
                        if (d.id !== parentUid && d.data().status !== 'removed') _hasOtherAdmin = true;
                    });
                    if (!_hasOtherAdmin) {
                        await updateDoc(doc(db, 'clubs', _entityId), {
                            hasAdmin: false,
                            adminUid: null,
                            adminEmail: null,
                            adminName: null,
                        });
                    }
                }
            } catch(entErr) { console.warn('[indDeleteParent] Error limpiando entidad individual:', entErr.message); }
        }

        if (typeof _saHideSpinner === 'function') _saHideSpinner();
        if (typeof _saToast === 'function') _saToast(`🗑️ ${email} eliminado completamente de la base de datos.`, 5000);
        openIndividualAdminPanel();
    } catch (e) {
        if (typeof _saHideSpinner === 'function') _saHideSpinner();
        if (typeof _saToast === 'function') _saToast('❌ Error: ' + e.message, 4000);
        console.error('[indDeleteParent]', e);
    }
};

// ═══════════════════════════════════════════════════════════════════
// indEliminarUsuario() — Eliminar usuario completamente (alias)
// ═══════════════════════════════════════════════════════════════════

window.indEliminarUsuario = async function indEliminarUsuario(parentUid, email) {
    // Misma lógica que indDeleteParent — elimina completamente
    return indDeleteParent(parentUid, email);
};

// ═══════════════════════════════════════════════════════════════════
// indEditCategory() — Edit user category
// ═══════════════════════════════════════════════════════════════════

window.indEditCategory = async function indEditCategory(parentUid, email) {
    const catOptions = IND_CATEGORIES.flatMap(cat =>
        IND_SUB_CATS.map(sub => {
            const val = _indSlotKey(cat.id, sub);
            return `<option value="${val}">${cat.label} ${sub}</option>`;
        })
    ).join('');

    const modal = document.getElementById('setup-modal');
    if (!modal) return;
    modal.style.display = 'flex';
    modal.innerHTML = SA_CSS + `
    <div class="modal-content sa-modal" style="max-width:480px;">
      <div class="sa-topbar">
        <div style="font-weight:700;font-size:1rem;">✏️ Cambiar categoría de ${_indEsc(email)}</div>
        <button onclick="openIndividualAdminPanel()"
            style="background:none;border:none;color:var(--text-muted);font-size:1.5rem;cursor:pointer;">✕</button>
      </div>
      <div class="sa-body" style="padding:1.5rem;">
        <div style="margin-bottom:1rem;">
            <label class="sa-label">Nueva categoría *</label>
            <select class="sa-input" id="ind-edit-category">${catOptions}</select>
        </div>
        <div style="display:flex;justify-content:flex-end;gap:0.5rem;">
            <button onclick="openIndividualAdminPanel()" class="sa-btn"
                style="color:#8b949e;border-color:rgba(139,148,158,0.3);background:rgba(139,148,158,0.07);">Cancelar</button>
            <button onclick="indSaveCategory('${_indEscA(parentUid).replace(/\\/g,'\\\\').replace(/'/g,"\\'")}','${_indEscA(email).replace(/\\/g,'\\\\').replace(/'/g,"\\'")}')"
                class="sa-btn" style="color:#3fb950;border-color:rgba(63,185,80,0.4);background:rgba(63,185,80,0.1);font-weight:700;">💾 Guardar</button>
        </div>
      </div>
    </div>`;
};

window.indSaveCategory = async function indSaveCategory(parentUid, email) {
    const catVal = document.getElementById('ind-edit-category')?.value;
    if (!catVal) return;
    const parts = catVal.split('_');
    const catId = parts[0];
    const subCat = parts[1] ? parts[1].toUpperCase() : 'A';
    const catLabel = _indCatLabel(catId, subCat);

    if (typeof _saShowSpinner === 'function') _saShowSpinner('Guardando…');
    try {
        const { db, doc, updateDoc, getDoc } = await saFS();
        const userSnap = await getDoc(doc(db, 'users', parentUid));
        let updateData = {
            category: catVal,
            categoryLabel: catLabel,
            subCategory: subCat,
            subcategory: subCat,
        };

        if (userSnap.exists()) {
            const data = userSnap.data();
            if (data.allRoles) {
                updateData.allRoles = data.allRoles.map(r => {
                    if (r.role === 'parent' || r.role === 'user') {
                        return { ...r, category: catVal, categoryLabel: catLabel, subcategory: subCat, subCategory: subCat };
                    }
                    return r;
                });
            }
        }

        await updateDoc(doc(db, 'users', parentUid), updateData);
        if (typeof _saHideSpinner === 'function') _saHideSpinner();
        if (typeof _saToast === 'function') _saToast(`✅ Categoría actualizada a ${catLabel}`, 3000);
        openIndividualAdminPanel();
    } catch (e) {
        if (typeof _saHideSpinner === 'function') _saHideSpinner();
        if (typeof _saToast === 'function') _saToast('❌ Error: ' + e.message, 4000);
        console.error('[indSaveCategory]', e);
    }
};

// ═══════════════════════════════════════════════════════════════════
// indSolicitarPadre() — Solicitar nuevo usuario al SA
// ═══════════════════════════════════════════════════════════════════

window.indSolicitarPadre = async function indSolicitarPadre() {
    const email = document.getElementById('ind-req-email')?.value?.trim();
    const name  = document.getElementById('ind-req-name')?.value?.trim();
    const cat   = document.getElementById('ind-req-category')?.value;
    const dorsal = document.getElementById('ind-req-dorsal')?.value?.trim();
    const alias = document.getElementById('ind-req-alias')?.value?.trim();
    const wa    = document.getElementById('ind-req-wa')?.value?.trim();
    const msgEl = document.getElementById('ind-req-msg');

    if (!email || !cat || !dorsal) {
        if (msgEl) { msgEl.style.color = '#ff5858'; msgEl.textContent = '⚠️ Email, categoría y dorsal son obligatorios.'; }
        return;
    }

    const d = window._indData;
    if (!d) return;
    const { me, displayName, userData } = d;
    const _entityId = userData?.individualEntityId || me.uid;

    if (typeof _saShowSpinner === 'function') _saShowSpinner('Enviando solicitud…');
    try {
        const { db, doc, setDoc } = await saFS();
        const catParts = cat.split('_');
        const catLabel = _indCatLabel(catParts[0], catParts[1] ? catParts[1].toUpperCase() : 'A');

        await setDoc(doc(db, 'platform_requests', `ind_req_${_entityId}_${Date.now()}`), {
            type: 'individual_user_request',
            individualOwnerId: _entityId,
            individualEmail: me.email,
            individualName: displayName || me.email,
            requestedEmail: email,
            requestedName: name,
            requestedRole: 'parent',
            requestedCategory: cat,
            requestedCategoryLabel: catLabel,
            requestedSubcat: catParts[1] ? catParts[1].toUpperCase() : 'A',
            playerNumber: parseInt(dorsal) || 0,
            playerAlias: alias || '',
            whatsapp: wa || '',
            status: 'pending_sa',
            createdAt: new Date().toISOString(),
        });

        if (typeof _saHideSpinner === 'function') _saHideSpinner();
        if (msgEl) { msgEl.style.color = '#3fb950'; msgEl.textContent = '✅ Solicitud enviada al SuperAdmin para ' + email; }
        // Limpiar formulario
        const em = document.getElementById('ind-req-email'); if (em) em.value = '';
        const nm = document.getElementById('ind-req-name'); if (nm) nm.value = '';
        const dr = document.getElementById('ind-req-dorsal'); if (dr) dr.value = '';
        const al = document.getElementById('ind-req-alias'); if (al) al.value = '';
        const wh = document.getElementById('ind-req-wa'); if (wh) wh.value = '';
        if (typeof _saToast === 'function') _saToast('✅ Solicitud enviada al SuperAdmin', 3000);
    } catch (e) {
        if (typeof _saHideSpinner === 'function') _saHideSpinner();
        if (msgEl) { msgEl.style.color = '#ff5858'; msgEl.textContent = '❌ ' + e.message; }
        console.error('[indSolicitarPadre]', e);
    }
};

// ═══════════════════════════════════════════════════════════════════
// NOTA: indAddOwnCoachRole e indAddOwnParentRole han sido ELIMINADOS.
// Los roles de entrenador y padre dentro del ente individual SOLO se
// obtienen a través del flujo de registro correcto:
//   Entrenador/Padre se registra → Admin Individual reenvía → SA confirma
// No se pueden auto-activar roles; deben venir del SuperAdmin.
// ═══════════════════════════════════════════════════════════════════

// ═══════════════════════════════════════════════════════════════════
// Compatibilidad: funciones antiguas de tabs (no-ops para evitar errores)
// ═══════════════════════════════════════════════════════════════════

window.indTab = function indTab() { /* v3: sin tabs */ };
window.indRenderOverview = function indRenderOverview() { openIndividualAdminPanel(); };
window.indRenderPending = function indRenderPending() { openIndividualAdminPanel(); };
window.indRenderRequestForm = function indRenderRequestForm() { openIndividualAdminPanel(); };
window.indRenderMembers = function indRenderMembers() { openIndividualAdminPanel(); };

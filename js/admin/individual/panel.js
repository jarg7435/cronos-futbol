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

// ⚠️ EL VOCABULARIO YA NO SE DECLARA AQUÍ (2026-07-30). Era la TERCERA copia de
// las mismas 7 categorías —las otras estaban en admin/club/panel.js y en
// admin/shared/category-tree.js—, y tres copias acaban desincronizándose: añadir
// una categoría obligaba a acordarse de tres sitios. La fuente única es
// window.CT_CATEGORIES, que publica js/admin/shared/category-tree.js.
// ⚠️ ESTO SE EVALÚA AL CARGAR EL FICHERO, no al usarlo, así que DEPENDE DEL
// ORDEN de los <script>: category-tree.js (index.html:1349) va antes que este
// (1365). Si alguien los reordena, aquí quedaría el respaldo y el panel
// mostraría un árbol vacío sin que nada falle a gritos. Lo fija el guard.
const IND_CATEGORIES = window.CT_CATEGORIES || [];
const IND_SUB_CATS   = window.CT_SUBCATS    || ['A', 'B', 'C'];

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
    const map = { prebenjamin:'Prebenjamín', benjamin:'Benjamín', alevin:'Alevín', infantil:'Infantil', cadete:'Cadete', juvenil:'Juvenil', regional:'Regional', regional_fem:'Regional FEM', futurefem:'FUTureFEM' };
    let label = map[cat] || map[cat.replace(/_[abc]$/,'')] || cat;
    if (sub) label += ' ' + sub;
    return label;
}

// ═══════════════════════════════════════════════════════════════════
// openIndividualAdminPanel() — Modal tipo Club Admin
// ═══════════════════════════════════════════════════════════════════

// v597 · `mantenerSeccion` distingue un REFRESCO de una ENTRADA. Las siete
// reinvocaciones internas (tras reenviar, rechazar, activar, borrar…) pasan
// `true` para devolverte a la sección donde estabas; sin eso cada acción te
// echaba al tablero. Al ENTRAR desde el selector de rol se llama sin argumento
// y se empieza en el menú, que es lo que se pidió.
// ⚠️ Es un parámetro EXPLÍCITO y no una heurística ("¿estaba el modal
// visible?") a propósito: una heurística acierta hasta el día que no.
async function openIndividualAdminPanel(mantenerSeccion = false) {
    if (!mantenerSeccion) window._indSeccionActual = 'menu';
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
    }
    const parents = Array.from(parentsMap.values());

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
    // ══════════════════════════════════════════════════════════════════
    //  🔴🔴🔴 v584 · ESTE PANEL CONTABA PLAZAS DE CLUB COMO SUYAS
    //
    //  Es el MISMO defecto que v583 cerró en el panel del SuperAdmin, pero
    //  aquí lo ve un usuario REAL: el administrador del ente. La pertenencia
    //  al ente sí está bien acotada —las consultas de arriba buscan por
    //  `individualOwnerId` / `individualEntityId` / `clubId`—, pero una vez
    //  dentro, estos contadores preguntaban "¿tiene algún rol de entrenador
    //  autorizado?" **sin mirar a qué club o ente pertenece esa plaza**.
    //
    //  Caso real (brunoromar2012): entrenador del Benjamín C de un CLUB y
    //  además usuario de un ente. Su equipo del club se contaba —y se
    //  pintaba— como equipo del ente. Los datos de un club y los de un ente
    //  no pueden cruzarse por compartir el correo: es la regla que el autor
    //  ha pedido blindar antes de abrir a usuarios reales.
    //
    //  ⚠️ El ancla admite `_queryId` Y `uid`: hay altas antiguas que guardaron
    //  el uid del administrador en vez del id del ente (por eso las consultas
    //  de arriba buscan por los dos). Aceptar sólo uno dejaría fuera a gente
    //  legítima del ente.
    // ══════════════════════════════════════════════════════════════════
    const _delEsteEnte = (r) => {
        if (!r) return false;
        if (typeof window.cronosRolDelEnte === 'function') {
            return window.cronosRolDelEnte(r, _queryId) ||
                   (uid !== _queryId && window.cronosRolDelEnte(r, uid));
        }
        const anclas = [String(r.clubId||''), String(r.individualEntityId||''), String(r.individualOwnerId||'')];
        return anclas.indexOf(String(_queryId)) >= 0 || anclas.indexOf(String(uid)) >= 0;
    };
    // Los roles anclados a ESTE ente. Si no hay ninguno, manda el rol de la
    // raíz (compat) — y la pertenencia al ente ya está comprobada arriba.
    const _rolesAqui = (u) => (Array.isArray(u.allRoles) ? u.allRoles : []).filter(_delEsteEnte);
    const _tieneAqui = (u, nombres) => {
        const propios = _rolesAqui(u);
        if (propios.length) {
            return propios.some(r => nombres.indexOf(r.role) >= 0 && (r.isAuthorized || u.isAuthorized));
        }
        return nombres.indexOf(u.role) >= 0;
    };
    const coachCount  = activeParents.filter(u => _tieneAqui(u, ['user', 'entrenador_individual'])).length;
    // Contar padres basándose en su rol principal o allRoles y su estado de autorización
    const parentCount = activeParents.filter(u => _tieneAqui(u, ['parent', 'parent_individual'])).length;

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
                category: u.category || u.categoryLabel, subcategory: u.subcategory }];
        }

        // FIX: Deduplicar roles (mismo role + category + subcategory)
        const _seenRoleKey = new Set();
        const uniqueRoles = roles.filter(r => {
            if (r.status === 'rejected' || r.status === 'removed') return false;
            const key = (r.role || '') + '|' + (r.category || '') + '|' + (r.subcategory || '');
            if (_seenRoleKey.has(key)) return false;
            _seenRoleKey.add(key);
            return true;
        });

        // ══════════════════════════════════════════════════════════════
        //  🔴🔴🔴 v584 · Y EL ÁRBOL PINTABA ESAS MISMAS PLAZAS AJENAS
        //
        //  Mismo cruce que los contadores de arriba: se expandían TODAS las
        //  plazas de la persona, así que el equipo que lleva en un CLUB
        //  aparecía dentro del árbol de categorías del ENTE. Sólo entran las
        //  plazas ancladas a este ente.
        //
        //  ⚠️ Si la persona no tiene NINGUNA plaza anclada (altas antiguas que
        //  no guardaban el ancla), se conserva el comportamiento anterior: se
        //  expanden sus roles. Vaciarle la fila a alguien que sí pertenece al
        //  ente sería cambiar un cruce por una desaparición, que es peor.
        // ══════════════════════════════════════════════════════════════
        const _propias = uniqueRoles.filter(_delEsteEnte);
        const rolesToExpand = _propias.length ? _propias : uniqueRoles;

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

    // ── Arbol jerarquico Categoria -> Subcategoria (sin bloque Staff) ──
    //   Portado de js/admin/club/panel.js · unifiedUserTable(). A diferencia
    //   del modelo Club, el Ente Individual NO tiene Director ni Coordinador:
    //   solo Entrenadores y Padres (el propio Admin puede ser su Entrenador).
    //   Por eso NO se renderiza el bloque de Staff superior.
    const _validCatIds = new Set(IND_CATEGORIES.map(c => c.id));

    // Normaliza el catId de un rol expandido. La categoria puede venir como
    //   · 'prebenjamin'            (id puro + subcategory separada), o
    //   · 'prebenjamin_a'          (slot key combinado de indSaveCategory).
    const _normCat = (r) => {
        let cat = String(r.category || r.categoryLabel || '').trim().toLowerCase();
        cat = cat.replace(/_[abc]$/, '');
        return cat;
    };
    const _normSub = (r) => {
        let sub = String(r.subcategory || '').trim().toUpperCase();
        if (!sub) {
            const m = String(r.category || '').match(/_([abc])$/i);
            if (m) sub = m[1].toUpperCase();
        }
        return sub;
    };

    // ── Indice O(n): catId -> (subId -> [filas]) — solo Entrenador/Padre ──
    // ⚽ v602 · EL DUEÑO DEL ENTE ENTRA EN EL ÍNDICE COMO ENTRENADOR. Antes se
    //   excluía a propósito ("admin individual u otros: fuera del arbol"), y
    //   con el modelo viejo era correcto: el administrador no entrenaba, sólo
    //   gestionaba. Desde la unificación (v599) el Entrenador Administrador
    //   Individual ES el entrenador de sus equipos; dejarlo fuera pinta
    //   equipos SIN entrenador, que es justo lo contrario de lo que ocurre.
    const _IND_COACH = new Set(['user', 'entrenador_individual', 'individual', 'admin_individual']);
    const _IND_PARENT = new Set(['parent', 'parent_individual']);
    const _IND_DUENO = new Set(['individual', 'admin_individual']);
    const _buildIndIndex = (eUsers) => {
        const byCatSub = new Map();
        const catHasAny = new Set();
        const subHasAny = new Set();
        eUsers.forEach(u => {
            const r = u._activeRoleData || {};
            const role = r.role || u.role;
            if (!_IND_COACH.has(role) && !_IND_PARENT.has(role)) return; // admin individual u otros: fuera del arbol
            const cat = _normCat(r);
            const sub = _normSub(r);
            if (!_validCatIds.has(cat)) return;        // sin categoria valida -> excluir
            if (!IND_SUB_CATS.includes(sub)) return;    // sin subcategoria valida -> excluir
            if (!byCatSub.has(cat)) byCatSub.set(cat, new Map());
            const subMap = byCatSub.get(cat);
            if (!subMap.has(sub)) subMap.set(sub, []);
            subMap.get(sub).push(u);
            catHasAny.add(cat);
            subHasAny.add(cat + '|' + sub);
        });
        return { byCatSub, catHasAny, subHasAny };
    };

    // ── Fila plana de un usuario (Entrenador/Padre) ──────────────────
    const _indUserRowHtml = (u) => {
        const r = u._activeRoleData || {};
        // ⚽ v602 · El dueño se presenta por lo que HACE en ese equipo, no por
        //   su rol técnico: ROLE_META['individual'] dice "Administrador
        //   Individual", y dentro de la ficha de un equipo eso no explica por
        //   qué aparece ahí. Y NO se le ofrece la papelera sobre sí mismo:
        //   borrarse desde su propio panel no es una acción, es un accidente.
        const _esElDueno = _IND_DUENO.has(r.role) || (u._id || u.uid) === uid;
        const roleMeta = _esElDueno
            ? { icon: '⚽', color: '#3fb950', label: 'Entrenador Administrador' }
            : (window.ROLE_META[r.role] || { icon: '👤', color: '#8b949e', label: r.role || 'Usuario' });
        let name = window.cronosNombreUsuario(u)   /* v534 · el correo NO es un nombre */;
        name = _eH(String(name).split(' ')[0]);
        let regDate = '–';
        if (u.createdAt) {
            let d;
            if (u.createdAt.toDate) d = u.createdAt.toDate();
            else if (typeof u.createdAt === 'number') d = new Date(u.createdAt);
            else if (u.createdAt.seconds) d = new Date(u.createdAt.seconds * 1000);
            else d = new Date(u.createdAt);
            if (d instanceof Date && !isNaN(d)) regDate = d.toLocaleDateString();
        } else if (u.authorizedAt) {
            const d = new Date(u.authorizedAt);
            if (d instanceof Date && !isNaN(d)) regDate = d.toLocaleDateString();
        }
        const pending = (!r.isAuthorized || r.status === 'pending_individual')
            ? '<span style="font-size:0.62rem;color:#ffa500;margin-left:0.3rem;">⏳</span>' : '';
        const euid = _eA(u._id);
        const email = _eA(u.email || u._id);
        return `
            <div style="display:grid; grid-template-columns:minmax(96px,auto) minmax(80px,1fr) minmax(0,2fr) auto auto;
                        align-items:center; gap:0.6rem; padding:0.55rem 0.6rem;
                        border-bottom:1px solid rgba(255,255,255,0.05);">
                <div style="font-size:0.7rem; color:${roleMeta.color}; font-weight:600; white-space:nowrap;">${roleMeta.icon} ${_eH(roleMeta.label)}${pending}</div>
                <div style="font-weight:600; color:white; font-size:0.85rem; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;">${name}</div>
                <div style="font-size:0.74rem; color:#8b949e; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;" title="${_eH(u.email || '')}">${_eH(u.email || '')}</div>
                <div style="font-size:0.72rem; color:#8b949e; white-space:nowrap;">${regDate}</div>
                <div style="display:flex; gap:0.4rem; flex-shrink:0; justify-content:flex-end;">
                    ${_esElDueno ? '<span style="font-size:0.66rem;color:#6e7681;white-space:nowrap;">tú</span>' : `
                    <button class="sa-btn" onclick="indEditCategory('${euid}','${email}')"
                        title="Cambiar categoria" style="padding:0.25rem 0.5rem; color:#79c0ff; border-color:rgba(121,192,255,0.2);">✏️</button>
                    <button class="sa-btn" onclick="indDeleteParent('${euid}','${email}')"
                        title="Eliminar usuario completamente" style="padding:0.25rem 0.5rem; color:#ff5858; border-color:rgba(255,88,88,0.2);">🗑️</button>`}
                </div>
            </div>`;
    };

    // ── Cabecera de columnas de una subcategoria ─────────────────────
    const _indRowHeaderHtml = () => `
            <div style="display:grid; grid-template-columns:minmax(96px,auto) minmax(80px,1fr) minmax(0,2fr) auto auto;
                        align-items:center; gap:0.6rem; padding:0.4rem 0.6rem;
                        border-bottom:1px solid rgba(255,255,255,0.1);">
                <div style="font-size:0.62rem; font-weight:700; color:#79c0ff; text-transform:uppercase; letter-spacing:0.6px;">Rol</div>
                <div style="font-size:0.62rem; font-weight:700; color:#79c0ff; text-transform:uppercase; letter-spacing:0.6px;">Nombre</div>
                <div style="font-size:0.62rem; font-weight:700; color:#79c0ff; text-transform:uppercase; letter-spacing:0.6px;">Email</div>
                <div style="font-size:0.62rem; font-weight:700; color:#79c0ff; text-transform:uppercase; letter-spacing:0.6px;">Fecha</div>
                <div></div>
            </div>`;

    // ⚠️⚠️ v602 · AQUÍ VIVÍA EL ÁRBOL DE 7×3 (`_indSubcategoryCardHtml`,
    //   `_indCategoryCardHtml`, `_indTreeHtml` y la tabla `unifiedUserTable`
    //   que los envolvía), Y SE HA RETIRADO ENTERO.
    //
    //   🔑🔑 SOBRABA PORQUE EL ENTE NO ES UN CLUB. Se portó del panel de Club,
    //   donde pintar las 21 casillas tiene sentido: un club puede llenarlas.
    //   Un ente individual lleva UNO o DOS equipos, así que 19 de las 21 salían
    //   vacías y las dos que importaban había que buscarlas entre ellas. Lo
    //   sustituyen las fichas de equipo de `_secMiEquipo` (más abajo).
    //
    //   🔑 SE BORRAN EN VEZ DE DEJARSE SIN LLAMAR: un constructor de vistas
    //   huérfano es justo lo que alguien revive por error dentro de seis meses
    //   creyendo que sigue en uso. Lo que SÍ se conserva es el ÍNDICE
    //   (`_buildIndIndex`) y la fila (`_indUserRowHtml`), que son las piezas
    //   que de verdad hacían el trabajo y ahora sirven a las fichas de equipo.
    const _indIdx = _buildIndIndex(sortedUsers);

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

    // ── Info box ──────────────────────────────────────────────────
    const infoHTML = `
    <div style="background:rgba(121,192,255,0.05);border:1px solid rgba(121,192,255,0.15);border-radius:8px;padding:0.7rem;font-size:0.75rem;color:#8b949e;line-height:1.5;margin-bottom:1rem;">
        ℹ️ <strong style="color:#79c0ff;">Flujo de registro del Ente Individual:</strong><br>
        1️⃣ El <strong>Administrador Individual</strong> se registra → solicitud va <strong>directamente al SuperAdmin</strong> → SA confirma → queda registrado.<br>
        2️⃣ El <strong>Entrenador/Padre</strong> se registra eligiendo tu entidad individual del desplegable → su solicitud aparece aquí en <strong>📨 Solicitudes</strong>.<br>
        3️⃣ Tú reenvías la solicitud al <strong>SuperAdmin</strong> → SA aprueba → el usuario queda <strong>registrado y activo</strong>.<br>
        4️⃣ Los iconos de rol solo aparecen <strong>después de estar registrados y confirmados</strong>.
    </div>`;

    // ── SECCIÓN: MI PLAN ──────────────────────────────────────────
    const billingHTML = `
        <div style="margin-top:0;">
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
        </div>`;

    // ════════════════════════════════════════════════════════════════
    //  ⚽⚽ v598 · MIS EQUIPOS — LAS DOS CATEGORÍAS DEL ENTE UNIFICADO
    //
    //  Encargo del autor (2026-08-21): el Entrenador Administrador Individual
    //  «podrá registrarse y operar en dos categorías y dos subcategorías
    //  diferentes (por ejemplo, una de Fútbol 7 y otra de Fútbol 11), mientras
    //  que el resto de categorías/subcategorías se quedarán inhabilitadas».
    //
    //  🔑 ESA REGLA YA EXISTÍA, para los entrenadores de club: `cronosPuedeLlevarEquipo`
    //  (utils.js, v537). Aquí NO se reimplementa — se INVOCA. Escribir un
    //  segundo "máximo dos, uno de cada modalidad" habría creado la típica
    //  pareja de reglas que diverge a la primera corrección.
    //
    //  🔑 QUÉ HACE VISIBLE LA LIMITACIÓN: el desplegable no ofrece "todas las
    //  categorías y luego te riño". Cuando ya tiene un equipo, sólo se listan
    //  las categorías de la OTRA modalidad; las de la suya salen `disabled` y
    //  dicen por qué. Que una opción desaparezca sin explicación es lo que
    //  hace pensar que la aplicación está rota (misma doctrina que el tablero).
    //
    //  ⚠️ Y AUN ASÍ SE VALIDA AL GUARDAR. `disabled` es cosmético (la lección
    //  de la v548): quien manipule el DOM se salta el desplegable, no el
    //  validador.
    // ════════════════════════════════════════════════════════════════
    const _indModalidad = (c) => (typeof window._cronosMatchModality === 'function')
        ? window._cronosMatchModality(c) : '';
    const _MOD_LBL = { f7: 'Fútbol 7', f11: 'Fútbol 11' };

    // Sus plazas de entrenador ANCLADAS A SU ENTE. Se reutiliza el mismo
    // criterio de "quién lleva equipo" que el resto del proyecto.
    const _ROLES_EQUIPO = window.CRONOS_ROLES_CON_EQUIPO || ['user', 'coach', 'individual', 'admin_individual'];
    const _misEquipos = (userData.allRoles || []).filter(r =>
        r && _ROLES_EQUIPO.indexOf(r.role) >= 0 &&
        r.status !== 'removed' && r.isAuthorized !== false &&
        r.category &&
        String(r.clubId || r.individualEntityId || '') === String(individualEntityId || '')
    );

    // La modalidad que YA cubre. Si tiene una, la segunda tiene que ser la otra.
    const _modsOcupadas = new Set(_misEquipos.map(r => _indModalidad(r.category)).filter(Boolean));
    const _puedeAnadir  = _misEquipos.length < 2;

    const _indOpcionesCat = IND_CATEGORIES.flatMap(cat =>
        IND_SUB_CATS.map(sub => {
            const val  = _indSlotKey(cat.id, sub);
            const mod  = _indModalidad(cat.id);
            // ⚠️ Se compara la PAREJA categoría+subcategoría, no sólo la
            //    categoría: "Alevín A" y "Alevín B" son equipos distintos.
            const yaEs = _misEquipos.some(r =>
                String(r.category || '') === String(val) ||
                (String(r.category || '') === String(cat.id) &&
                 String(r.subcategory || '').toUpperCase() === String(sub).toUpperCase()));
            const chocaMod = mod && _modsOcupadas.has(mod);
            const bloq = yaEs || chocaMod;
            const nota = yaEs ? ' — ya es tuyo'
                       : chocaMod ? ' — ya llevas un equipo de ' + (_MOD_LBL[mod] || mod)
                       : '';
            return '<option value="' + _indEscA(val) + '"' + (bloq ? ' disabled' : '') + '>' +
                   _indEsc(cat.label + ' ' + sub + nota) + '</option>';
        })
    ).join('');

    const _secMisEquipos = `
        <div class="sa-card" style="border-color:rgba(63,185,80,0.3);">
          <div style="font-size:0.72rem;color:var(--text-muted);margin-bottom:0.9rem;
                      padding:0.5rem 0.7rem;background:rgba(63,185,80,0.05);
                      border-radius:6px;border:1px solid rgba(63,185,80,0.15);line-height:1.5;">
            Como <strong style="color:#3fb950;">Entrenador Administrador Individual</strong> puedes llevar
            <strong>hasta dos equipos</strong>: uno de <strong>Fútbol 7</strong> y otro de <strong>Fútbol 11</strong>.
            Dos de la misma modalidad no está permitido.
          </div>

          ${_misEquipos.length === 0 ? `
            <div style="text-align:center;padding:1.6rem 1rem;color:var(--text-muted);font-size:0.85rem;">
              Todavía no tienes ningún equipo asignado.
            </div>` : ''}

          <!-- ⚠️ v602 · AQUÍ HABÍA UNA LISTA PLANA DE SUS EQUIPOS, Y SE HA
               RETIRADO. Cada equipo tiene ahora su propia ficha justo debajo,
               con su entrenador y sus familias dentro; repetir arriba los
               mismos dos nombres era parte de la duplicación a quitar. -->

          ${_puedeAnadir ? `
            <div style="margin-top:1rem;padding-top:0.9rem;border-top:1px solid rgba(255,255,255,0.07);">
              <label class="sa-label">${_misEquipos.length === 0 ? 'Elige tu equipo' : 'Añadir mi segundo equipo'} *</label>
              <select class="sa-input" id="ind-mi-equipo">${_indOpcionesCat}</select>
              <div style="display:flex;justify-content:flex-end;margin-top:0.7rem;">
                <button onclick="indAnadirMiEquipo()" class="sa-btn"
                    style="color:#3fb950;border-color:rgba(63,185,80,0.4);background:rgba(63,185,80,0.1);font-weight:700;">
                    ➕ Añadir equipo</button>
              </div>
              <div id="ind-mi-equipo-msg" style="font-size:0.78rem;margin-top:0.5rem;min-height:1.1rem;"></div>
            </div>` : `
            <div style="margin-top:0.6rem;font-size:0.74rem;color:var(--text-muted);
                        padding:0.5rem 0.7rem;background:rgba(255,255,255,0.03);border-radius:6px;">
              ✅ Ya llevas los dos equipos que permite la regla: uno de Fútbol 7 y otro de Fútbol 11.
            </div>`}
        </div>
    `;

    // ════════════════════════════════════════════════════════════════
    //  ⚽👥 v602 · UNA SOLA SECCIÓN: "MI EQUIPO"
    //
    //  Encargo del autor (2026-08-21, capturas 9397-9401): «unificar al máximo
    //  Mis Usuarios, Mis Equipos y Resumen en una sola. Que dentro de cada
    //  categoría y subcategoría aparezcan el entrenador y todos los padres o
    //  tutores vinculados. Eliminar las tarjetas duplicadas del tablero».
    //
    //  Las tres eran vistas del MISMO puñado de gente: el resumen los contaba,
    //  los equipos decían de qué categoría eran y los usuarios los listaban en
    //  un árbol de 21 casillas. Ahora se dice una vez, y en el orden en que se
    //  pregunta: cuántos hay → qué equipos llevo → quién está en cada uno.
    //
    //  ⚠️⚠️ Y NADIE PUEDE DESAPARECER. Un usuario del ente cuya categoría no
    //  sea ninguno de sus dos equipos (un padre mal asignado, un entrenador de
    //  legado, alguien sin categoría válida) existía antes y sigue existiendo:
    //  va al bloque "Otros usuarios del ente", con su aviso y su ✏️. Cambiar un
    //  exceso de ruido por una desaparición silenciosa es el peor negocio
    //  posible — es la lección de v581 y de v584.
    // ════════════════════════════════════════════════════════════════

    // Sus equipos, en forma canónica {catId, sub}. La categoría se guarda de
    // dos maneras históricas ('alevin' + subcategory, o 'alevin_a' de una
    // pieza): se normalizan las dos, igual que hacen _normCat/_normSub.
    const _misEquiposNorm = _misEquipos.map(r => {
        const catId = String(r.category || '').trim().toLowerCase().replace(/_[abc]$/, '');
        let sub = String(r.subcategory || '').trim().toUpperCase();
        if (!sub) {
            const m = String(r.category || '').match(/_([abc])$/i);
            if (m) sub = m[1].toUpperCase();
        }
        return { catId, sub, mod: _indModalidad(r.category), label: _indCatLabel(catId, sub) };
    }).filter(e => e.catId);

    const _clavesMias = new Set(_misEquiposNorm.map(e => e.catId + '|' + e.sub));

    const _filasIndice = (catId, sub) => {
        const subMap = _indIdx.byCatSub.get(catId);
        return (subMap && subMap.get(sub)) ? subMap.get(sub).slice() : [];
    };

    // ⚠️ EL DUEÑO PUEDE NO ESTAR EN `parents`. Las consultas de arriba lo traen
    //    casi siempre (buscan por clubId / individualEntityId / ownerId), pero
    //    "casi siempre" no basta cuando lo que se pinta es QUIÉN ENTRENA ESTE
    //    EQUIPO: si faltara, su propio equipo saldría sin entrenador. Se añade
    //    la fila a partir de sus PLAZAS, que son el dato que de verdad dice qué
    //    equipos lleva.
    const _yoComoFila = (plaza) => ({
        _id: uid, uid, email: me.email,
        firstName: userData.firstName, lastName: userData.lastName,
        displayName: userData.displayName,
        createdAt: userData.createdAt, authorizedAt: userData.authorizedAt,
        status: 'active', isAuthorized: true,
        _activeRoleData: plaza,
    });

    const _esFilaEntrenador = (f) => _IND_COACH.has((f._activeRoleData || {}).role || f.role);

    const _fichaEquipo = (eq) => {
        const filas = _filasIndice(eq.catId, eq.sub);
        if (!filas.some(f => (f._id || f.uid) === uid)) {
            filas.unshift(_yoComoFila({
                role: 'individual', isAuthorized: true, status: 'active',
                category: eq.catId, subcategory: eq.sub,
            }));
        }
        const entrenadores = filas.filter(_esFilaEntrenador);
        const familias     = filas.filter(f => !_esFilaEntrenador(f));

        const bloque = (titulo, arr, vacio) => `
            <div style="margin-bottom:0.7rem;">
              <div style="font-size:0.63rem;font-weight:700;color:#79c0ff;text-transform:uppercase;
                          letter-spacing:0.6px;padding:0 0.6rem 0.35rem;">${titulo}
                <span class="sa-badge" style="background:rgba(121,192,255,0.12);color:#79c0ff;">${arr.length}</span>
              </div>
              ${arr.length
                ? _indRowHeaderHtml() + arr.map(_indUserRowHtml).join('')
                : '<div style="font-size:0.74rem;color:#6e7681;padding:0.45rem 0.6rem;">' + vacio + '</div>'}
            </div>`;

        return `
            <div class="sa-card expanded" style="margin-bottom:0.7rem;border-color:rgba(63,185,80,0.28);">
              <div class="sa-card-head" onclick="this.closest('.sa-card').classList.toggle('expanded')">
                <div class="sa-card-title">
                  <span class="sa-chevron">▼</span>
                  <span>⚽ ${_eH(eq.label)}</span>
                  ${eq.mod ? '<span class="sa-badge" style="background:rgba(63,185,80,0.15);color:#3fb950;">'
                             + _eH(_MOD_LBL[eq.mod] || eq.mod) + '</span>' : ''}
                  <span class="sa-badge" style="background:rgba(255,255,255,0.06);color:#8b949e;">${filas.length}</span>
                </div>
              </div>
              <div class="sa-card-body">
                ${bloque('⚽ Entrenador', entrenadores, 'Este equipo no tiene entrenador asignado.')}
                ${bloque('👨‍👩‍👧 Padres / Madres / Tutores', familias, 'Todavía no hay familias vinculadas a este equipo.')}
              </div>
            </div>`;
    };

    // ── Los que NO caen en ninguno de sus equipos: se muestran igual ──
    const _filasHuerfanas = [];
    const _enElArbol = new Set();
    const _claveFila = (f) => {
        const r = f._activeRoleData || {};
        return (f._id || f.uid) + '|' + (r.role || '') + '|' + (r.category || '') + '|' + (r.subcategory || '');
    };
    _indIdx.byCatSub.forEach((subMap, catId) => {
        subMap.forEach((arr, sub) => {
            arr.forEach(f => {
                _enElArbol.add(_claveFila(f));
                if (_clavesMias.has(catId + '|' + sub)) return;
                _filasHuerfanas.push(f);
            });
        });
    });
    // ⚠️ Y los que el índice descartó por no tener categoría válida: para el
    //    árbol no existían. Aquí sí, porque son personas del ente — y son
    //    precisamente las que hay que poder reasignar.
    sortedUsers.forEach(u => {
        if ((u._id || u.uid) === uid) return;      // sus propias plazas no son huérfanas
        if (_enElArbol.has(_claveFila(u))) return;
        _filasHuerfanas.push(u);
    });

    const _secOtros = _filasHuerfanas.length ? `
        <div class="sa-card" style="border-color:rgba(240,136,62,0.25);">
          <div class="sa-card-head" onclick="this.closest('.sa-card').classList.toggle('expanded')">
            <div class="sa-card-title" style="font-size:0.84rem;">
              <span class="sa-chevron">▼</span>
              <span>📋 Otros usuarios del ente</span>
              <span class="sa-badge" style="background:rgba(240,136,62,0.15);color:#f0883e;">${_filasHuerfanas.length}</span>
            </div>
          </div>
          <div class="sa-card-body">
            <div style="font-size:0.72rem;color:var(--text-muted);padding:0.5rem 0.6rem 0.7rem;line-height:1.5;">
              Pertenecen a tu entidad pero su categoría no coincide con ninguno de tus equipos.
              Puedes reasignarles la categoría con ✏️.
            </div>
            ${_indRowHeaderHtml()}
            ${_filasHuerfanas.map(_indUserRowHtml).join('')}
          </div>
        </div>` : '';

    const _secMiEquipo =
        statsHTML +
        _secMisEquipos +
        (_misEquiposNorm.length
            ? '<div style="margin-top:1rem;">' + _misEquiposNorm.map(_fichaEquipo).join('') + '</div>'
            : '') +
        (_secOtros ? '<div style="margin-top:0.6rem;">' + _secOtros + '</div>' : '');

    // ════════════════════════════════════════════════════════════════
    //  🎛️ v597 · TABLERO DE ENTRADA, IGUAL QUE EL DEL ADMIN DE CLUB
    //
    //  Aquí el reparto salió casi gratis: este panel ya tenía sus bloques en
    //  constantes con nombre (statsHTML, saForwardHTML, pendingRegHTML,
    //  unifiedUserTable, infoHTML). Lo único que se hizo fue
    //  dejar de concatenarlas todas en el cuerpo y repartirlas por secciones.
    //  El marcado de cada bloque NO se ha tocado.
    // ════════════════════════════════════════════════════════════════
    const _indPendientes = (pendingAutoReg || []).length + (pendingSAForward || []).length;

    // ⚠️ v598 · `infoHTML` SE QUEDA, PERO EN SOLICITUDES. Explica el flujo de
    //    registro del ente ("el entrenador o el padre se registra eligiendo tu
    //    entidad → su solicitud aparece aquí → tú la reenvías al SuperAdmin"),
    //    que es EXACTAMENTE el camino que el autor quiere como único. Vivía
    //    dentro de 📩 Solicitar Alta, que hoy desaparece; tirarlo con ella
    //    habría sido perder la única explicación escrita del procedimiento
    //    bueno, y justo en la pantalla donde hace falta leerla.
    // ⚽👥 v602 · TRES SECCIONES EN UNA.
    //   ⚠️ Las claves viejas se conservan como ALIAS de la nueva. `indTab`
    //   echa al MENÚ cualquier argumento que no reconozca, y `_indSeccionActual`
    //   guarda la sección entre repintados: sin los alias, quien viniera de un
    //   'usuarios' o 'resumen' guardado acabaría en el menú sin saber por qué.
    const _IND_SECCIONES = {
        equipo:      { titulo: '⚽ Mi Equipo',       html: _secMiEquipo },
        usuarios:    { titulo: '⚽ Mi Equipo',       html: _secMiEquipo },
        equipos:     { titulo: '⚽ Mi Equipo',       html: _secMiEquipo },
        resumen:     { titulo: '⚽ Mi Equipo',       html: _secMiEquipo },
        solicitudes: { titulo: '✅ Solicitudes',     html: (saForwardHTML || '') + (pendingRegHTML || '') + (infoHTML || '') },
        plan:        { titulo: '💳 Mi Suscripción',  html: billingHTML },
    };

    const _indOpciones = [
        // ⚽ v601 · La ida a partidos pasa por `cronosEntrarAPartidos`
        //    (role-launch.js): desde la v601 el ente aterriza con el terreno de
        //    juego OCULTO —para no verlo antes que su panel— y hay que volver a
        //    enseñarlo aquí. El respaldo es el comportamiento de siempre, que
        //    sólo se queda corto en el fondo de pantalla.
        { icono: '⚽', titulo: 'Crear Partido', color: '#3fb950',
          desc: 'Ir al panel de partido y empezar a cronometrar.',
          onclick: "if(typeof cronosEntrarAPartidos==='function') cronosEntrarAPartidos(); else (function(){ const m=document.getElementById('setup-modal'); if(m) m.style.display='none'; if(typeof openSetupModal==='function') openSetupModal(); })()" },
        // ⚽👥 v602 · UNA TARJETA DONDE HABÍA TRES (Mis Usuarios / Mis Equipos /
        //    Resumen): las tres llevaban a la misma gente vista de tres
        //    maneras. El badge sigue siendo el número de equipos, que es el
        //    dato que decide si puede añadir otro.
        { icono: '⚽', titulo: 'Mi Equipo', color: '#3fb950',
          badge: _misEquipos.length,
          desc: _misEquipos.length >= 2
              ? 'Tus dos equipos (F7 y F11), con su entrenador y sus familias.'
              : _misEquipos.length === 1
                  ? 'Tu equipo y sus familias — y puedes añadir el segundo.'
                  : 'Elige tu equipo y gestiona a sus familias.',
          onclick: "indTab('equipo')" },
        // 🔴 v598 · El número de pendientes deja de ser texto pegado al título
        //    y pasa a ser píldora roja (`badge`, utils.js). Mismo cambio que en
        //    el panel del Admin de Club: se ve desde el tablero sin entrar.
        { icono: '✅', titulo: 'Solicitudes', color: '#f0883e',
          badge: _indPendientes,
          desc: _indPendientes
              ? 'Tienes ' + _indPendientes + ' pendiente(s) de reenviar al SuperAdmin.'
              : 'Altas pendientes de reenviar al SuperAdmin.',
          onclick: "indTab('solicitudes')" },
        // ⚠️ v602 · "👥 Mis Usuarios" y "📊 Resumen" YA NO SON TARJETAS. Su
        //    contenido no se ha perdido: abre "⚽ Mi Equipo", donde el cuadro de
        //    cifras es lo primero que se ve y las familias están dentro de su
        //    equipo. Se retiran del TABLERO, no del panel.
        { icono: '💳', titulo: 'Mi Plan', color: '#ffd700',
          desc: 'Suscripción, facturas y forma de pago.',
          onclick: "indTab('plan')" },
        { icono: '💬', titulo: 'Mensajes', color: '#d2a8ff',
          desc: 'Canales internos con el SuperAdmin y con tu entrenador.',
          onclick: "if(typeof openIndividualAdminMessaging==='function') openIndividualAdminMessaging('coaches'); else if(typeof showToast==='function') showToast('⚠️ Mensajería no disponible', 3000);" },
        // ⚠️ v598 · FALTAN DOS TARJETAS RESPECTO A LA v597, A PROPÓSITO:
        //   · 📩 Solicitar Alta        — el interesado se registra solo.
        //   · 📡 Transmitir al SuperAdmin — escribía un aviso que NADIE leía.
        // Las dos retiradas se explican junto a las funciones que las servían.
    ];

    // ⚠️ Mismo respaldo que en el panel de Club: sin el helper cargado se
    // pintan todas las secciones seguidas en vez de dejar el panel en blanco.
    const _indMenuHtml = (typeof window.cronosTableroHtml === 'function')
        ? window.cronosTableroHtml({
            titulo: '👤 ' + displayName,
            subtitulo: 'Panel del Entrenador Administrador Individual — elige qué quieres gestionar:',
            opciones: _indOpciones,
          })
        : Object.keys(_IND_SECCIONES).map(k => _IND_SECCIONES[k].html).join('');

    window.indTab = function indTab(sec) {
        const cuerpo = document.getElementById('ind-body');
        const barra  = document.getElementById('ind-navbar');
        if (!cuerpo) return;
        window._indSeccionActual = sec;
        if (sec === 'menu' || !_IND_SECCIONES[sec]) {
            window._indSeccionActual = 'menu';
            if (barra) { barra.style.display = 'none'; barra.innerHTML = ''; }
            cuerpo.innerHTML = _indMenuHtml;
            return;
        }
        if (barra) {
            barra.style.display = 'flex';
            barra.innerHTML =
                '<button onclick="indTab(\'menu\')" ' +
                'style="display:inline-flex;align-items:center;gap:0.4rem;' +
                       'padding:0.42rem 0.9rem;border-radius:8px;cursor:pointer;' +
                       'background:rgba(88,166,255,0.12);border:1px solid rgba(88,166,255,0.4);' +
                       'color:#58a6ff;font-size:0.8rem;font-weight:800;">' +
                '← Volver al Menú</button>' +
                '<span style="font-size:0.9rem;font-weight:800;color:white;">' +
                _IND_SECCIONES[sec].titulo + '</span>';
        }
        cuerpo.innerHTML = _IND_SECCIONES[sec].html;
        cuerpo.scrollTop = 0;
    };

    // ── Assemble full modal ───────────────────────────────────────
    setupModal.innerHTML = SA_CSS + `
    <style>
      #ind-navbar { display:none; align-items:center; gap:0.7rem;
                    padding:0 0 0.9rem; flex-wrap:wrap; }
    </style>
    <div class="modal-content sa-modal">
      <div class="sa-topbar">
        <div>
          <div style="font-size:1.15rem;font-weight:700;">👤 ${_eH(displayName)}</div>
          <div style="font-size:0.76rem;color:var(--text-muted);margin-top:0.1rem;">Panel del Entrenador Administrador Individual</div>
        </div>
        <div style="display:flex;gap:0.7rem;flex-wrap:wrap;">
          <!-- ⚠️ v597 · Crear Partido, Mensajes y Transmitir al SuperAdmin se
               han bajado al tablero, cada uno con su explicación. Aquí arriba
               eran cuatro botones seguidos sin decir para qué servían. -->
          <button onclick="if(typeof cerrarSesion==='function')cerrarSesion();else if(typeof logoutUser==='function')logoutUser();"
              style="padding:0.45rem 1rem;background:rgba(255,88,88,0.15);
                     border:1px solid rgba(255,88,88,0.4);border-radius:10px;
                     color:#ff5858;font-size:0.75rem;font-weight:700;cursor:pointer;">
              🚪 SALIR</button>
        </div>
      </div>

      <div class="sa-body">
        <div id="ind-navbar"></div>
        <div id="ind-body"></div>
      </div>
    </div>`;

    // Pintar la sección: después del innerHTML, porque indTab busca #ind-body.
    window.indTab(window._indSeccionActual || 'menu');

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
    if (u.category === catId && (u.subcategory||'').toUpperCase() === subCat.toUpperCase()) return true;
    if (u.category === catFilter) return true;
    const lbl = (u.categoryLabel || '').toLowerCase();
    if (lbl.includes(catId) && lbl.includes(subCat.toLowerCase())) return true;
    if ((u.allRoles||[]).some(r =>
        (r.category === catId && (r.subcategory||'').toUpperCase() === subCat.toUpperCase()) ||
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
// 🗑️ indNotifySuperAdmin() — "📡 Transmitir al SuperAdmin" — YA NO EXISTE
// ═══════════════════════════════════════════════════════════════════
//  🔴🔴🔴 v598 · RETIRADA. Es el gemelo exacto de `caNotifySuperAdmin` del
//  panel del Admin de Club, y falla por lo mismo: escribía en
//  `platform_requests` un documento con `type:'individual_notification'` y
//  `status:'unread'`, y el SuperAdmin sólo lee de esa colección
//  `status=='pending_sa'` o `type=='quota_increase' && status=='unread'`
//  (`saPendingItems`, js/admin/superadmin/requests-tab.js:75-76). Ni una ni
//  otra. Censo del proyecto: `individual_notification` aparecía ÚNICAMENTE en
//  la línea que la escribía.
//
//  🔑 Y encima confirmaba el envío: «✅ Notificación enviada al SuperAdmin».
//  El administrador se quedaba esperando una respuesta a un mensaje que no
//  había llegado a ninguna bandeja. Para hablar con el SuperAdmin está
//  💬 Mensajes (`openIndividualAdminMessaging`), que sí funciona y se queda.


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
        openIndividualAdminPanel(true);
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
        openIndividualAdminPanel(true);
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
            const sub = (roleInAll && roleInAll.subcategory) || data.requestedSubcat;

            if (cat) {
                updateData.category      = cat;
                updateData.categoryLabel = (roleInAll && roleInAll.categoryLabel) || (typeof _indCatLabel==='function' ? _indCatLabel(cat.split('_')[0], cat.split('_')[1]||'') : cat);
                if (sub) {
                    updateData.subcategory = sub;
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
        openIndividualAdminPanel(true);
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
        openIndividualAdminPanel(true);
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
        const { db, fa, doc, getDoc, deleteDoc, collection, getDocs, query, where, updateDoc, setDoc, httpsCallable } = await saFS();

        // FIX: Read user data before deletion to check if they're an admin and get entity info
        const userSnap = await getDoc(doc(db, 'users', parentUid)).catch(() => null);
        const uData = userSnap && userSnap.exists() ? userSnap.data() : {};
        const _entityId = uData.individualEntityId || uData.clubId || null;
        const _isAdminIndiv = uData.role === 'individual' || uData.role === 'admin_individual'
            || (uData.allRoles||[]).some(r => (r.role === 'individual' || r.role === 'admin_individual') && r.isAuthorized);

        // ── Multi-rol: solo eliminar la cuenta Auth si el usuario NO conserva
        //    roles activos en OTRA entidad. Si los tiene, se borra de esta
        //    base de datos pero la cuenta de Firebase Auth se preserva.
        const _allRoles = uData.allRoles || [];
        const _otherActiveRoles = _allRoles.filter(r => {
            const sameEntity = String(r.clubId || r.individualEntityId || '') === String(_entityId || '');
            const isActive = r.isAuthorized === true && r.status !== 'removed' && r.status !== 'rejected';
            return !sameEntity && isActive;
        });
        const _shouldDeleteAuth = _otherActiveRoles.length === 0;

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

        // If they have roles in other entities/clubs, preserve document & auth account
        const rolesRemovidos = _allRoles.filter(r => {
            const sameEntity = String(r.clubId || r.individualEntityId || '') === String(_entityId || '');
            return sameEntity;
        });

        if (_otherActiveRoles.length > 0) {
            // Update allRoles in primary document
            await updateDoc(doc(db, 'users', parentUid), { allRoles: _otherActiveRoles });
            // Delete secondary documents for removed roles
            for (const r of rolesRemovidos) {
                const secId = parentUid + '_' + r.role + '_' + (r.clubId || r.individualEntityId || 'global');
                if (secId !== parentUid) {
                    try { await deleteDoc(doc(db, 'users', secId)); } catch (_) {}
                }
            }
            if (typeof _saToast === 'function') _saToast('➖ Usuario removido de esta entidad. Conserva sus roles en otros clubes.', 4000);
            if (typeof _saHideSpinner === 'function') _saHideSpinner();
            openIndividualAdminPanel(true);
            return;
        }

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

        // ── Eliminar cuenta de Firebase Auth (vía Cloud Function) — ÚLTIMA operación.
        //    Solo si no quedan roles activos en otra entidad. El fallo NO se ignora:
        //    se registra en auth_deletion_failures y se avisa al admin.
        if (_shouldDeleteAuth && httpsCallable && fa && fa.functions) {
            try {
                const _authRes = await httpsCallable(fa.functions, 'deleteAuthUser')({ uid: parentUid, email });
            } catch(cfErr) {
                console.error('[indDeleteParent] deleteAuthUser FALLÓ:', cfErr && cfErr.code, cfErr && cfErr.message);
                try {
                    const _me = window._cronosCurrentUser || {};
                    await setDoc(doc(db, 'auth_deletion_failures', parentUid + '_' + Date.now()), {
                        uid: parentUid, email, entityId: _entityId || null,
                        errorCode: (cfErr && cfErr.code) || null,
                        errorMessage: (cfErr && cfErr.message) || String(cfErr),
                        requestedBy: _me.uid || null, requestedByEmail: _me.email || null,
                        createdAt: new Date().toISOString()
                    });
                } catch(_) {}
                if (typeof _saToast === 'function') {
                    _saToast('⚠️ Datos borrados, pero la cuenta de Auth de ' + email +
                             ' NO se pudo eliminar. Registrado para revisión.', 6000);
                }
            }
        }

        if (typeof _saHideSpinner === 'function') _saHideSpinner();
        if (typeof _saToast === 'function') _saToast(`🗑️ ${email} eliminado completamente de la base de datos.`, 5000);
        openIndividualAdminPanel(true);
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
    // ════════════════════════════════════════════════════════════════
    //  v535 · AHORA ARCHIVA ANTES DE BORRAR
    //
    //  Antes esto era un alias de `indDeleteParent`, que llama directamente a
    //  `deleteAuthUser` y **se salta el archivado**. Es exactamente la pérdida
    //  de datos que arregló v502 para el panel de Club: la plantilla vive en
    //  una SUBCOLECCIÓN que no se borra con el documento padre y quedaba
    //  ilegible para siempre.
    //
    //  El autor pidió PARIDAD entre los tres paneles. Paridad de verdad es que
    //  los tres archiven y verifiquen antes de borrar, no que los tres tengan
    //  botón. Se delega en el flujo compartido, que además confirma tecleando
    //  el correo.
    // ════════════════════════════════════════════════════════════════
    //  ⚠️ Sin rol ni ente: la Cloud Function los resuelve del documento del
    //  objetivo, y NUNCA de lo que mande el cliente. Pasar aquí un rol
    //  adivinado no aportaría nada y podría contradecir al servidor.
    if (typeof window.cronosEliminarUsuarioSeguro === 'function') {
        return window.cronosEliminarUsuarioSeguro({ uid: parentUid, email: email });
    }
    alert('⚠️ No se puede eliminar ahora mismo: falta el módulo de borrado seguro. ' +
          'Recarga la página e inténtalo de nuevo. No se ha borrado nada.');
    return false;
};

// ═══════════════════════════════════════════════════════════════════
//  ⚽⚽ v598 · indAnadirMiEquipo() — el ente unificado se añade un equipo
// ═══════════════════════════════════════════════════════════════════
//  Escribe UNA plaza más en su propio `allRoles`, anclada a su ente.
//
//  🔑 POR QUÉ UNA PLAZA Y NO UN CAMPO `category2`. La unidad de este proyecto
//  es la PLAZA (v540): rol + ancla + categoría. Guardar la segunda categoría en
//  un campo aparte habría dejado fuera al selector de equipo del partido, a la
//  plantilla, al semáforo y al informe — todos leen `allRoles`. Añadiéndola
//  como plaza, el selector de `openSetupModal` la ofrece sin tocar una línea.
//
//  🔑 LAS REGLAS SÍ LE DEJAN. `firestore.rules` prohíbe al usuario escribir en
//  su propio documento los campos de RAÍZ que dan acceso —'role',
//  'isAuthorized', 'status', 'clubId', 'clubName'…— pero `allRoles` está
//  expresamente permitido (rules:487-489). Y no hay escalada: es su MISMO rol,
//  en su MISMO ente, con otra categoría; el `isAuthorized` de la raíz —el
//  único en el que confía el arranque de sesión— no se toca.
//
//  ⚠️⚠️ NADA DE `catch {}` MUDO AQUÍ. Una escritura denegada por reglas es
//  exactamente el fallo que este proyecto ya ha pagado dos veces (v583: "no se
//  guarda y no da error"). Si Firestore rechaza, se ve el motivo en pantalla.
window.indAnadirMiEquipo = async function indAnadirMiEquipo() {
    const d = window._indData;
    const sel = document.getElementById('ind-mi-equipo');
    const msg = document.getElementById('ind-mi-equipo-msg');
    const decir = (txt, color) => { if (msg) { msg.style.color = color; msg.textContent = txt; } };
    if (!d)   return decir('⚠️ Recarga el panel e inténtalo de nuevo.', '#ff5858');
    if (!sel || !sel.value) return decir('⚠️ Elige una categoría.', '#ff5858');

    const catVal = sel.value;                       // p.ej. 'alevin_a'
    const partes = String(catVal).split('_');
    const catId  = partes[0];
    const subCat = partes[1] ? partes[1].toUpperCase() : 'A';
    const label  = _indCatLabel(catId, subCat);
    const { uid, userData } = d;
    const enteId = userData.individualEntityId || userData.clubId || null;

    // ── EL CANDADO DE VERDAD ────────────────────────────────────────
    // ⚠️ Se valida aquí aunque el desplegable ya deshabilite lo prohibido:
    //    `disabled` es cosmético (v548). Y se usa la MISMA función que el
    //    entrenador de club, no una copia.
    if (typeof window.cronosPuedeLlevarEquipo === 'function') {
        const v = window.cronosPuedeLlevarEquipo(userData.allRoles || [], catVal, enteId);
        if (!v.ok) return decir('🚫 ' + v.motivo, '#ff5858');
    }
    // Y la comprobación que el validador no hace: el MISMO equipo dos veces.
    const yaLoTiene = (userData.allRoles || []).some(r =>
        r && r.status !== 'removed' && r.isAuthorized !== false &&
        String(r.clubId || r.individualEntityId || '') === String(enteId || '') &&
        (String(r.category || '') === String(catVal) ||
         (String(r.category || '') === String(catId) &&
          String(r.subcategory || '').toUpperCase() === subCat)));
    if (yaLoTiene) return decir('🚫 Ya llevas ese equipo.', '#ff5858');

    if (typeof _saShowSpinner === 'function') _saShowSpinner('Añadiendo equipo…');
    try {
        const { db, doc, updateDoc } = await saFS();
        // La plaza nueva es del MISMO rol y del MISMO ente: sólo cambia el equipo.
        const nueva = {
            role:          'individual',
            clubId:        enteId,
            individualEntityId: enteId,
            clubName:      userData.clubName || '',
            isAuthorized:  true,
            status:        'active',
            firstName:     userData.firstName || null,
            lastName:      userData.lastName  || null,
            category:      catVal,
            subcategory:   subCat,
            categoryLabel: label,
        };
        await updateDoc(doc(db, 'users', uid), {
            allRoles: (userData.allRoles || []).concat([nueva]),
        });
        if (typeof _saHideSpinner === 'function') _saHideSpinner();
        if (typeof _saToast === 'function') _saToast('✅ Equipo añadido: ' + label, 3000);
        window._indSeccionActual = 'equipo';
        openIndividualAdminPanel(true);
    } catch (e) {
        if (typeof _saHideSpinner === 'function') _saHideSpinner();
        console.error('[indAnadirMiEquipo]', e);
        decir('❌ No se pudo guardar: ' + (e && e.message ? e.message : e), '#ff5858');
    }
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
        <button onclick="openIndividualAdminPanel(true)"
            style="background:none;border:none;color:var(--text-muted);font-size:1.5rem;cursor:pointer;">✕</button>
      </div>
      <div class="sa-body" style="padding:1.5rem;">
        <div style="margin-bottom:1rem;">
            <label class="sa-label">Nueva categoría *</label>
            <select class="sa-input" id="ind-edit-category">${catOptions}</select>
        </div>
        <div style="display:flex;justify-content:flex-end;gap:0.5rem;">
            <button onclick="openIndividualAdminPanel(true)" class="sa-btn"
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
            subcategory: subCat,
        };

        if (userSnap.exists()) {
            const data = userSnap.data();
            if (data.allRoles) {
                updateData.allRoles = data.allRoles.map(r => {
                    if (r.role === 'parent' || r.role === 'user') {
                        return { ...r, category: catVal, categoryLabel: catLabel, subcategory: subCat };
                    }
                    return r;
                });
            }
        }

        await updateDoc(doc(db, 'users', parentUid), updateData);
        if (typeof _saHideSpinner === 'function') _saHideSpinner();
        if (typeof _saToast === 'function') _saToast(`✅ Categoría actualizada a ${catLabel}`, 3000);
        openIndividualAdminPanel(true);
    } catch (e) {
        if (typeof _saHideSpinner === 'function') _saHideSpinner();
        if (typeof _saToast === 'function') _saToast('❌ Error: ' + e.message, 4000);
        console.error('[indSaveCategory]', e);
    }
};

// ═══════════════════════════════════════════════════════════════════
// NOTA: indAddOwnCoachRole e indAddOwnParentRole han sido ELIMINADOS.
// Los roles de entrenador y padre dentro del ente individual SOLO se
// obtienen a través del flujo de registro correcto:
//   Entrenador/Padre se registra → Admin Individual reenvía → SA confirma
// No se pueden auto-activar roles; deben venir del SuperAdmin.
//
// 🗑️ v598 · Y CON ELLOS SE VA `indSolicitarPadre` Y SU FORMULARIO
// (`requestFormHTML`, la sección 📩 Solicitar Alta). Encargo del autor
// (2026-08-21), y es el MISMO criterio que ya rige en la nota de arriba
// llevado hasta el final: si el alta sólo puede nacer de que el interesado se
// registre por su cuenta, un formulario donde el administrador teclea el
// correo de otro es una segunda puerta al mismo sitio — y la que no debía
// existir. El camino bueno no se toca: el entrenador o el padre se registra
// eligiendo la entidad, su solicitud cae en ✅ Solicitudes, y desde allí se
// reenvía al SuperAdmin con `indForwardToSA`, que sigue intacta.
// ═══════════════════════════════════════════════════════════════════

// ═══════════════════════════════════════════════════════════════════
// 🗑 v597 · BLOQUE DE "COMPATIBILIDAD" RETIRADO — ver la nota de abajo
// ═══════════════════════════════════════════════════════════════════

//  Cinco envoltorios de una versión con pestañas que ya no existe:
//  indTab (un no-op), indRenderOverview, indRenderPending,
//  indRenderRequestForm e indRenderMembers. Censo del 2026-08-21: NO LOS
//  LLAMABA NADIE — ni este fichero, ni ningún otro, ni ningún onclick.
//
//  🔴🔴 Y uno era una bomba de relojería con nombre: `window.indTab`. El
//  tablero de v597 define su propio `window.indTab` DENTRO de
//  openIndividualAdminPanel, así que hoy gana el bueno por puro orden —éste
//  se asignaba al CARGAR el fichero y el mío al ABRIR el panel—. Bastaba con
//  mover esta línea detrás, o con que alguien llamase a indTab antes de abrir
//  el panel, para que el menú entero dejase de responder SIN UN SOLO ERROR en
//  la consola: un no-op no falla, simplemente no hace nada.
//
//  🔑 Dos funciones con el mismo nombre en el mismo fichero no son
//  "compatibilidad": son un defecto esperando al orden de carga que le
//  convenga. Lo fija la parte 6 de scripts/test_paneles_admin_tablero.js,
//  que exige que window.indTab se asigne UNA sola vez en todo el proyecto.

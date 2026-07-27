// ════════════════════════════════════════════════════════════════════
//  CRONOS FÚTBOL · Selección de rol y arranque de la aplicación
//  Extraído de js/services/auth.js (auditoría 2026-07-22, monolito #4,
//  paso 1). Movimiento MECÁNICO: cero cambios de comportamiento.
//
//  ⚠️ ESTO ES UN MÓDULO ES, no un script clásico como el resto del
//  refactor. NO se enlaza con <script> en index.html: entra por el
//  `import` que auth.js tiene arriba. Si lo añades también como <script>
//  suelto, el navegador lo ejecutaría DOS VECES.
//  Corolario útil: aquí una referencia a un nombre inexistente NO compila
//  y el módulo falla al cargar de forma ruidosa — al contrario que el
//  ReferenceError silencioso que se coló en producción en v378 con los
//  scripts clásicos.
//
//  Contenido, en el orden en que se encadenan:
//    enterApp() → showRoleSelection() → selectOption() →
//      _saPickTestClub() (sólo SuperAdmin sin club) → _launchWithRole()
//      → _renderCoordinatorTypePill()
//
//  FAN-OUT CERO: no necesita NADA de auth.js — ni funciones, ni su estado
//  de ámbito de módulo (_isLoginMode, SUPERADMIN_EMAILS, …). La
//  dependencia va al revés: auth.js importa enterApp, showRoleSelection y
//  selectOption de aquí, porque conserva seis llamadas a enterApp() y los
//  tres alias window.enterApp / showRoleSelector / selectOption.
//
//  ⚠️ ESCRIBE window._cronosCurrentUser (dos veces): el global más leído
//  del proyecto, con 47 archivos consumiéndolo. _launchWithRole lo
//  sincroniza con la entrada de allRoles que corresponde al rol activo,
//  que es lo que hace que al cambiar de rol se arranque con el club
//  correcto.
//
//  ⚠️ FILTRO DE SEGURIDAD, NO TOCAR A LA LIGERA: showRoleSelection sólo
//  muestra roles con isAuthorized === true Y status === "active"; y si no
//  hay ninguno activo, sólo cae al rol raíz cuando ESE está confirmado.
//  Es lo que impide que una cuenta pendiente de aprobación entre en la
//  aplicación. Lo fijan las partes 3f y 3j del test.
//
//  Test: scripts/test_role_launch_module.js
// ════════════════════════════════════════════════════════════════════

export function enterApp() {
    const authScreen = document.getElementById('auth-screen');
    if (authScreen) authScreen.style.display = 'none';
    document.body.classList.remove('locked');
    showRoleSelection();
}

// ── Pantalla de Selección de Rol ──────────────────────────────
export function showRoleSelection() {
    // alias usado por saGoBackToRoles en 16_superadmin.js
    window.showRoleSelector = showRoleSelection;
    
    const me = window._cronosCurrentUser;
    if (!me) {
        console.warn('[RoleSelection] No user found in state');
        return;
    }

    const screen = document.getElementById('role-selection-screen');
    if (!screen) return;
    screen.style.display = 'flex';

    const allCards = [
        'card-opt-superadmin', 'card-opt-clubadmin',
        'card-opt-director',   'card-opt-coordinator',
        'card-opt-coach',      'card-opt-parent',
        'card-opt-individual',
        'card-opt-coach-individual', 'card-opt-parent-individual',
    ];

    allCards.forEach(id => {
        const el = document.getElementById(id);
        if (el) el.style.display = 'none';
    });

    const show = (id) => {
        const el = document.getElementById(id);
        if (el) el.style.display = 'block';
    };

    // 1. Caso SuperAdmin
    if (['superadmin', 'admin'].includes(me.role)) {
        allCards.forEach(id => show(id));
        return;
    }

    // 2. Multi-rol y roles específicos
    // Solo mostrar paneles de roles ACTIVOS (isAuthorized=true AND status='active')
    const activeRoles = (me.allRoles || [])
        .filter(r => r.isAuthorized === true && r.status === 'active');

    // Si solo hay un rol activo, entrar directamente sin mostrar la pantalla de selección
    if (activeRoles.length === 1) {
        screen.style.display = 'none';
        const r = activeRoles[0];
        const isUnderIndividual = !!(r.individualEntityId || r.isIndividual);
        let option = r.role;
        if (r.role === 'club_admin')       option = 'clubadmin';
        else if (['coach','user'].includes(r.role)) option = isUnderIndividual ? 'coach_individual' : 'coach';
        else if (['parent','parent_individual','padre_individual'].includes(r.role)) option = isUnderIndividual ? 'parent_individual' : 'parent';
        else if (['individual','admin_individual'].includes(r.role)) option = 'individual';
        selectOption(option);
        return;
    }

    if (activeRoles.length > 0) {
        activeRoles.forEach(r => {
            // Determinar si el rol está bajo una entidad individual
            const isUnderIndividual = !!(r.individualEntityId || r.isIndividual);
            if (r.role === 'club_admin')                        show('card-opt-clubadmin');
            else if (r.role === 'director')                     show('card-opt-director');
            else if (r.role === 'coordinator')                  show('card-opt-coordinator');
            else if (['coach','user'].includes(r.role))         isUnderIndividual ? show('card-opt-coach-individual') : show('card-opt-coach');
            else if (['parent','parent_individual','padre_individual'].includes(r.role)) isUnderIndividual ? show('card-opt-parent-individual') : show('card-opt-parent');
            else if (['individual','admin_individual'].includes(r.role)) show('card-opt-individual');
            else if (r.role === 'entrenador_individual')        show('card-opt-coach-individual');
        });
    } else {
        // Fallback al rol raíz SOLO si está activo y autorizado
        // CRITICAL FIX: No mostrar paneles si el usuario no está confirmado
        const r = me.role;
        const isRootActive = me.isAuthorized === true && me.status === 'active';
        if (!isRootActive) {
            console.warn('[RoleSelection] User has no active confirmed roles. Not showing any panels.');
            return;
        }
        const _isIndiv = !!(me.clubId && me.isIndividual);
        if (r === 'club_admin')                        show('card-opt-clubadmin');
        else if (r === 'director')                     show('card-opt-director');
        else if (r === 'coordinator')                  show('card-opt-coordinator');
        else if (['coach','user'].includes(r))         _isIndiv ? show('card-opt-coach-individual') : show('card-opt-coach');
        else if (['parent','parent_individual'].includes(r)) _isIndiv ? show('card-opt-parent-individual') : show('card-opt-parent');
        else if (['individual','admin_individual'].includes(r)) show('card-opt-individual');
    }
}

// ── Lanzar App con la opción seleccionada ─────────────────────
export function selectOption(option) {
    const me = window._cronosCurrentUser;
    if (!me) return;

    const map = {
        'superadmin':  'superadmin',
        'clubadmin':   'club_admin',
        'director':    'director',
        'coordinator': 'coordinator',
        'coach':       'user',
        'parent':      'parent',
        'individual':  'individual',
        'admin_individual': 'individual',
        'coach_individual': 'user',
        'parent_individual': 'parent',
    };

    me._activeRole = map[option] || me.role;

    const isSA         = ['superadmin','admin'].includes(me.role);
    const needsClub    = ['club_admin','director','coordinator','user','parent','individual'].includes(me._activeRole);
    const alreadyHasClub = !!me.clubId;

    if (isSA && needsClub && !alreadyHasClub) {
        _saPickTestClub(me._activeRole);
        return;
    }

    _launchWithRole(me._activeRole);
}

// ── Selector de club para pruebas del SuperAdmin ──────────────
async function _saPickTestClub(targetRole) {
    const me = window._cronosCurrentUser;
    try {
        const fa = window._cronos_auth;
        const m  = await import('https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js');
        const snap = await m.getDocs(m.collection(fa.db, 'clubs'));
        const allClubs = [];
        snap.forEach(d => allClubs.push({ id: d.id, ...d.data() }));

        // FIX: When targetRole is 'individual', only show individual entities
        const isIndivRole = ['individual', 'admin_individual'].includes(targetRole);
        const clubs = isIndivRole
            ? allClubs.filter(c => c.type === 'individual')
            : allClubs.filter(c => c.type !== 'individual');

        const roleIcon = isIndivRole ? '👤' : '🏟️';
        const entityLabel = isIndivRole ? 'ente individual' : 'club';

        const overlay = document.createElement('div');
        overlay.id = 'sa-club-picker';
        overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.8);z-index:99999;' +
            'display:flex;align-items:center;justify-content:center;padding:1rem;';
        overlay.innerHTML = `
        <div style="background:#161b22;border:1px solid rgba(88,166,255,0.3);border-radius:16px;
                    padding:1.5rem;width:min(96vw,440px);max-height:85vh;overflow-y:auto;">
            <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:1rem;">
                <div>
                    <div style="font-weight:700;font-size:1rem;color:white;">🧪 Modo Prueba</div>
                    <div style="font-size:0.76rem;color:#7d8590;margin-top:2px;">
                        ¿En qué club quieres actuar como <strong style="color:#58a6ff;">${targetRole}</strong>?
                    </div>
                </div>
                <button id="sa-picker-close"
                    style="background:none;border:none;color:#7d8590;font-size:1.5rem;cursor:pointer;">✕</button>
            </div>
            ${clubs.length === 0
                ? `<p style="color:#7d8590;text-align:center;padding:1.5rem;">No hay ${entityLabel}s creados aún.<br>
                   <span style="font-size:0.78rem;">Crea uno desde el panel SuperAdmin.</span></p>`
                : clubs.map(c => `
                <button class="sa-club-btn" data-id="${c.id}" data-name="${(c.name||c.id).replace(/"/g,'')}"
                    style="width:100%;text-align:left;padding:0.85rem 1rem;margin-bottom:0.5rem;
                           background:rgba(255,255,255,0.04);border:1px solid rgba(255,255,255,0.1);
                           border-radius:10px;cursor:pointer;color:white;font-size:0.88rem;transition:all 0.2s;">
                    ${roleIcon} <strong>${c.name || c.id}</strong>
                    <span style="font-size:0.7rem;color:#7d8590;display:block;margin-top:2px;">
                        ${c.adminEmail || 'Sin admin'} · Plan: ${c.plan || 'free'}
                    </span>
                </button>`).join('')
            }
            <button id="sa-picker-noclub"
                style="width:100%;padding:0.7rem;background:rgba(255,255,255,0.03);
                       border:1px dashed rgba(255,255,255,0.15);border-radius:8px;
                       color:#7d8590;font-size:0.8rem;cursor:pointer;margin-top:0.3rem;">
                Continuar sin club asignado (funcionalidad limitada)
            </button>
        </div>`;
        document.body.appendChild(overlay);

        overlay.querySelectorAll('.sa-club-btn').forEach(btn => {
            btn.addEventListener('mouseenter', () => {
                btn.style.background    = 'rgba(88,166,255,0.1)';
                btn.style.borderColor   = 'rgba(88,166,255,0.35)';
            });
            btn.addEventListener('mouseleave', () => {
                btn.style.background    = 'rgba(255,255,255,0.04)';
                btn.style.borderColor   = 'rgba(255,255,255,0.1)';
            });
            btn.addEventListener('click', () => {
                // SECURITY FIX (SEC-002): Use full reassignment for protected props
                window._cronosCurrentUser = { ...me, clubId: btn.dataset.id, clubName: btn.dataset.name };
                overlay.remove();
                showToast(`🧪 Actuando en "${btn.dataset.name}" como ${targetRole}`, 3000);
                _launchWithRole(me._activeRole);
            });
        });

        document.getElementById('sa-picker-close').addEventListener('click', () => {
            overlay.remove();
            document.getElementById('role-selection-screen').style.display = 'flex';
        });
        document.getElementById('sa-picker-noclub').addEventListener('click', () => {
            overlay.remove();
            _launchWithRole(me._activeRole);
        });

    } catch(e) {
        console.error('Error cargando clubes para prueba:', e);
        _launchWithRole(me._activeRole);
    }
}

function _launchWithRole(role) {
    const activeRole = window._cronosCurrentUser?._activeRole || role;
    document.getElementById('role-selection-screen').style.display = 'none';

    // Detectar si es un rol individual (entrenador o padre bajo ente individual)
    // FIX: 'let' para poder reasignar tras spread
    let me = window._cronosCurrentUser;

    // ══════════════════════════════════════════════════════════════════
    //  MULTI-ROL FIX: Cargar datos específicos del rol activo
    //  ─────────────────────────────────────────────────────────────────
    //  Un mismo usuario puede ser club_admin + director + coordinator +
    //  user (entrenador) + parent al mismo tiempo. Cada rol tiene sus
    //  propios datos en allRoles[N]: clubId, inviteCode, playerAlias...
    //  PROBLEMA: el top-level del doc Firestore solo refleja el rol
    //  principal (el que se guardó último), así que al cambiar de rol
    //  hay que sincronizar window._cronosCurrentUser con la entrada
    //  correcta de allRoles[].
    // ══════════════════════════════════════════════════════════════════
    if (me && Array.isArray(me.allRoles)) {
        // Buscar la entrada de allRoles que coincida con el rol activo.
        // Si hay varias entradas del mismo rol, priorizar la del mismo clubId actual.
        const currentClubId = me.clubId;
        // Alias de roles: un mismo rol puede almacenarse con distintas claves
        const _roleAliases = {
            'user':    ['user', 'coach', 'entrenador_individual', 'user_individual'],
            'parent':  ['parent', 'parent_individual', 'padre_individual'],
            'individual': ['individual', 'admin_individual'],
            'club_admin': ['club_admin', 'admin'],
            'director': ['director', 'coordinator'],
            'coordinator': ['coordinator', 'director'],
            'admin_individual': ['admin_individual', 'individual'],
            'entrenador_individual': ['entrenador_individual', 'user', 'coach'],
            'parent_individual': ['parent_individual', 'parent', 'padre_individual'],
        };
        const _matchRoles = _roleAliases[role] || [role];
        const roleEntry =
            me.allRoles.find(r => _matchRoles.includes(r.role) && r.clubId === currentClubId) ||
            me.allRoles.find(r => _matchRoles.includes(r.role)) ||
            // Fallback: buscar por prefijo (ej: 'user' coincide con 'user_XXX')
            me.allRoles.find(r => r.role && r.role.startsWith(role.split('_')[0]));

        if (roleEntry) {
            // ── Campos comunes: clubId y clubName del rol activo ──
            // SECURITY FIX (SEC-002): Use full reassignment for protected props
            if (roleEntry.clubId || roleEntry.clubName) {
                window._cronosCurrentUser = {
                    ...me,
                    ...(roleEntry.clubId   ? { clubId: roleEntry.clubId } : {}),
                    ...(roleEntry.clubName ? { clubName: roleEntry.clubName } : {}),
                };
            }
            me = window._cronosCurrentUser;

            // ── Campos exclusivos del rol 'parent' ──
            // inviteCode (ej: 'J10') vincula al jugador hijo
            if (role === 'parent' || role === 'parent_individual') {
                if (roleEntry.inviteCode)    me.inviteCode    = roleEntry.inviteCode;
                if (roleEntry.playerAlias)   me.playerAlias   = roleEntry.playerAlias;
                if (roleEntry.playerNumber)  me.playerNumber  = roleEntry.playerNumber;
                // Derivar playerNumber del inviteCode si no está explícito ('J10' → '10')
                if (!me.playerNumber && me.inviteCode) {
                    const _icMatch = String(me.inviteCode).match(/^J-?(\d+)$/i);
                    if (_icMatch) me.playerNumber = _icMatch[1];
                }
            }

            // ── Campos exclusivos del rol 'user' (entrenador) ──
            if (role === 'user' || role === 'coach') {
                if (roleEntry.category)    me.category    = roleEntry.category;
                if (roleEntry.subcategory) me.subcategory = roleEntry.subcategory;
                console.log('[auth] entrenador category:', me.category, 'subcategory:', me.subcategory);
                // FIX: forzar updateCategoryOptions despues de asignar category
                setTimeout(function() {
                    if (typeof window.updateCategoryOptions === 'function') {
                        const mode = document.getElementById('setup-mode')?.value || 'f7';
                        window.updateCategoryOptions(mode);
                    }
                }, 300);
            }

            // FIX (Error #26): cargar extras del club para mostrar/ocultar opciones
            // del panel del entrenador segun el plan contratado.
            // Usar funcion async autoejecutable porque _launchWithRole no es async.
            (async () => {
                try {
                    const { doc, getDoc } = await import('https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js');
                    const _db = window._cronos_auth?.db;
                    if (!_db) { me.extras = {}; return; }
                    const clubId2 = roleEntry.clubId || me.clubId;
                    if (clubId2) {
                        const clubDoc = await getDoc(doc(_db, 'clubs', clubId2));
                        if (clubDoc.exists()) {
                            me.extras = clubDoc.data().extras || {};
                        } else {
                            const indDoc = await getDoc(doc(_db, 'individuals', clubId2));
                            if (indDoc.exists()) {
                                me.extras = indDoc.data().extras || {};
                            }
                        }
                        console.log('[auth] extras del club cargados:', me.extras);
                        // FIX: re-renderizar el modal si esta abierto
                        if (typeof window._cronosRefreshExtras === 'function') {
                            setTimeout(window._cronosRefreshExtras, 100);
                        }
                    }
                } catch(extrasErr) {
                    console.warn('[auth] error cargando extras:', extrasErr.message);
                    me.extras = {};
                }
            })();

            // ── Campo exclusivo del rol 'coordinator' (tipo F7/F11/F7&11) ──
            if (role === 'coordinator') {
                if (roleEntry.coordinatorType) me.coordinatorType = roleEntry.coordinatorType;
            }

        } else {
            // El SA entra a todos los paneles por diseño — no tiene entradas en allRoles para roles que no son suyos.
            if (!['superadmin','admin'].includes(me.role)) {
                if(window._CRONOS_DEBUG) console.warn('[RoleLaunch] No se encontró entrada en allRoles para rol:', role,
                    '| allRoles disponibles:', (me.allRoles || []).map(r => r.role).join(', '));
            }
        }
    }

    const isUnderIndividual = !!(me?.isIndividual || me?.individualEntityId);
    const isFieldRole = ['user', 'coach', 'individual', 'admin_individual'].includes(activeRole);
    const isParent    = (activeRole === 'parent' || activeRole === 'parent_individual');
    const isSA        = (activeRole === 'superadmin');
    const isAdminJob  = ['director', 'coordinator', 'club_admin'].includes(activeRole);

    // ── Verificar acceso al club y cargar umbrales del semáforo ──────────
    // checkClubAccess (js/core/app-init.js) valida que el club no este
    // bloqueado/vencido y publica window._clubTimerThresholds para getTimerColor.
    // Antes estaba definida pero nunca invocada, asi que los umbrales del
    // director no se cargaban al login (solo al empezar un partido).
    // Best-effort: no bloquea el arranque ni espera a la promesa.
    if (typeof window.checkClubAccess === 'function') {
        window.checkClubAccess(window._cronosCurrentUser).catch(() => {});
    }

    document.getElementById('main-container').style.display = isFieldRole || (isUnderIndividual && activeRole === 'user') ? 'flex' : 'none';
    document.getElementById('main-header').style.display    = isFieldRole || (isUnderIndividual && activeRole === 'user') ? 'flex' : 'none';

    if (isAdminJob || isSA) {
        document.body.style.background = '#0d1117';
    } else if (isFieldRole || (isUnderIndividual && activeRole === 'user')) {
        document.body.style.background = '';
    }

    const btnAdmin = document.getElementById('btn-admin-panel');
    if (btnAdmin) {
        btnAdmin.style.display = (
            ['admin', 'superadmin'].includes(window._cronosCurrentUser.role) &&
            activeRole === window._cronosCurrentUser.role
        ) ? 'inline-block' : 'none';
    }

    const btnClub = document.getElementById('btn-club-panel');
    if (btnClub) {
        btnClub.style.display =
            (window._cronosCurrentUser.role === 'club_admin') ? 'inline-block' : 'none';
    }

    // ── Botón ADMIN solo para rol "individual" ────────────────────
    const btnIndAdmin = document.getElementById('btn-individual-admin');
    if (btnIndAdmin) {
        if (activeRole === 'individual') {
            btnIndAdmin.style.display    = 'inline-flex';
            btnIndAdmin.style.visibility = 'visible';
        } else {
            btnIndAdmin.style.display = 'none';
        }
    }

    sessionStorage.setItem('cronos_session_uid',   window._cronosCurrentUser.uid);
    sessionStorage.setItem('cronos_session_email', window._cronosCurrentUser.email);
    sessionStorage.setItem('cronos_session_role',  activeRole);

    // [Cronos-Privacy] Red de seguridad: purga idempotente antes de sincronizar.
    if (typeof window._purgeStaleLocalDataIfNeeded === 'function') window._purgeStaleLocalDataIfNeeded(window._cronosCurrentUser?.uid);
    // SPRINT 4: Inicializar sync de Training Plans (+ NotificationDismiss localStorage)
    if (typeof window._initSprint4Sync === 'function') window._initSprint4Sync();

    if (activeRole === 'parent' || activeRole === 'parent_individual') {
        if (typeof openParentPanel === 'function') openParentPanel();
    } else if (activeRole === 'superadmin') {
        if (typeof openSuperAdminPanel === 'function') openSuperAdminPanel();
    } else if (activeRole === 'club_admin') {
        if (typeof openClubAdminPanel === 'function') openClubAdminPanel();
    } else if (['director', 'coordinator'].includes(activeRole)) {
        if (typeof openStaffDashboard === 'function') openStaffDashboard();
        // Pill de solo lectura con el tipo de coordinación (F7/F11/F7&11) ya fijo.
        if (activeRole === 'coordinator') _renderCoordinatorTypePill(window._cronosCurrentUser);
    } else if (activeRole === 'individual') {
        // Individual: primero cargar el campo, luego abrir el panel de gestión
        if (typeof init === 'function') init(activeRole);
        setTimeout(() => {
            if (typeof openIndividualAdminPanel === 'function') openIndividualAdminPanel();
        }, 300);
    } else {
        if (typeof init === 'function') init(activeRole);
    }
}

// ── Pill de solo lectura: tipo de coordinación (F7/F11/F7&11) ya fijo ──
// Mismo estilo visual que el badge de categoría en individual/panel.js.
// Se inyecta en la cabecera del Panel de Dirección (openStaffDashboard).
function _renderCoordinatorTypePill(me) {
    try {
        const ct = me && me.coordinatorType;
        if (!ct) return;
        const LABELS = { f7: 'Fútbol 7', f11: 'Fútbol 11', f711: 'Fútbol 7 y 11' };
        const label = LABELS[ct] || ct;
        // Reintentar porque openStaffDashboard puede renderizar de forma asíncrona.
        let tries = 0;
        const inject = () => {
            const modal = document.getElementById('setup-modal');
            const sub = modal && Array.from(modal.querySelectorAll('div')).find(d =>
                /\uD83C\uDFAF\s*Coordinador/.test(d.textContent || '') && d.children.length === 0);
            if (!sub) {
                if (tries++ < 20) return setTimeout(inject, 150);
                return;
            }
            if (sub.querySelector('[data-coord-type-pill]')) return;
            const pill = document.createElement('span');
            pill.setAttribute('data-coord-type-pill', ct);
            pill.textContent = '\uD83C\uDFAF ' + label;
            pill.style.cssText = 'font-size:0.68rem;color:#d2a8ff;background:rgba(210,168,255,0.1);'
                + 'border:1px solid rgba(210,168,255,0.2);border-radius:4px;padding:1px 6px;margin-left:0.4rem;';
            sub.appendChild(pill);
        };
        inject();
    } catch (_) { /* no-op: la pill es informativa */ }
}

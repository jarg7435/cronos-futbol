// ════════════════════════════════════════════════════════════════════
//  CHRONOS FÚTBOL · Selección de rol y arranque de la aplicación
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

export async function enterApp() {
    const authScreen = document.getElementById('auth-screen');
    if (authScreen) authScreen.style.display = 'none';
    document.body.classList.remove('locked');
    // v596 · Los extras de las entidades de sus plazas ANTES de pintar el
    // selector. Ver _precargarExtrasDeRoles: sin esto las tarjetas se
    // pintarían siempre abiertas y el candado llegaría tarde.
    await _precargarExtrasDeRoles();
    showRoleSelection();
}

// ════════════════════════════════════════════════════════════════════
//  v596 · LOS ROLES COMO EXTRAS — LA CACHÉ DE EXTRAS POR ENTIDAD
// ════════════════════════════════════════════════════════════════════
//  🔑 EL PROBLEMA QUE OBLIGA A ESTA PIEZA: `window._cronosCurrentUser.extras`
//  NO EXISTE TODAVÍA cuando se pinta el selector de rol. Se carga dentro de
//  _launchWithRole (más abajo), en una autoejecutable async, o sea DESPUÉS
//  de que el usuario ya haya elegido. Gatear las tarjetas con `me.extras`
//  las dejaría SIEMPRE abiertas —`undefined !== false` es true— y el candado
//  aparecería, si acaso, medio segundo tarde. Un guard así da verde sobre el
//  defecto real.
//
//  🔑 Y NO BASTA CON UN SOLO MAPA DE EXTRAS: los extras son de la ENTIDAD, y
//  una persona puede tener plazas en varios clubes (v540: la unidad es la
//  PLAZA). Puede ser coordinador en un club que sí lo contrata y en otro que
//  no. Por eso se cachea POR ENTIDAD y cada plaza se juzga con la suya.
//
//  ⚠️⚠️ FALLA HACIA EL "SÍ", SIEMPRE. Si la lectura falla, si no hay red, si
//  el documento no existe o si se agota el plazo, NO SE BLOQUEA NADA. Es la
//  misma regla que `!== false` en _cronosExtraEnabled y por el mismo motivo:
//  bloquear por un fallo de lectura deja a un director fuera de su panel sin
//  ningún error a la vista. Un fallo no es una decisión comercial.
//  Por eso un error NO se cachea: el siguiente intento vuelve a preguntar.
const _EXTRAS_TIMEOUT_MS = 4000;

function _entidadDeLaPlaza(r) {
    return String((r && (r.clubId || r.individualEntityId)) || '');
}

async function _cargarExtrasEntidad(entityId) {
    if (!entityId) return null;
    const cache = window._cronosExtrasEntidad || (window._cronosExtrasEntidad = {});
    if (Object.prototype.hasOwnProperty.call(cache, entityId)) return cache[entityId];
    try {
        const { doc, getDoc } = await import('https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js');
        const _db = window._cronos_auth?.db;
        if (!_db) return null;
        let snap = await getDoc(doc(_db, 'clubs', entityId));
        if (!snap.exists()) snap = await getDoc(doc(_db, 'individuals', entityId));
        cache[entityId] = snap.exists() ? (snap.data().extras || {}) : {};
        return cache[entityId];
    } catch (e) {
        // ⚠️ NO se cachea el fallo: se falla hacia el "sí" y se reintenta luego.
        console.warn('[extras] no se pudieron leer los extras de', entityId, e && e.message);
        return null;
    }
}

async function _precargarExtrasDeRoles() {
    try {
        const me = window._cronosCurrentUser;
        if (!me) return;
        const ids = new Set();
        (me.allRoles || [])
            .filter(r => r && r.isAuthorized === true && r.status === 'active')
            .forEach(r => { const id = _entidadDeLaPlaza(r); if (id) ids.add(id); });
        if (me.clubId) ids.add(String(me.clubId));
        if (!ids.size) return;
        // ⚠️ CON PLAZO. Sin él, una lectura colgada dejaría al usuario mirando
        // una pantalla vacía para siempre: el selector se pinta DESPUÉS de esto.
        await Promise.race([
            Promise.all([...ids].map(id => _cargarExtrasEntidad(id))),
            new Promise(resolve => setTimeout(resolve, _EXTRAS_TIMEOUT_MS)),
        ]);
    } catch (e) {
        console.warn('[extras] precarga incompleta:', e && e.message);
    }
}
window._cronosPrecargarExtrasDeRoles = _precargarExtrasDeRoles;

// ¿Está bloqueada ESTA plaza por su extra de rol? Devuelve el MOTIVO (cadena
// no vacía) o '' si puede entrar. Cadena vacía = adelante, en todos los
// caminos de fallo.
function _motivoPlazaBloqueada(role, entityId) {
    const mapa = window.CRONOS_ROL_EXTRA || {};
    const key  = mapa[role];
    if (!key) return '';                                   // rol sin extra: nunca se bloquea
    const extras = (window._cronosExtrasEntidad || {})[String(entityId || '')];
    if (!extras) return '';                                // sin datos → FAIL-OPEN
    if (extras[key] !== false) return '';                  // ausente o true → activo
    return (window.CRONOS_ROL_EXTRA_MOTIVO || {})[key]
        || 'Este acceso no está contratado en el plan de tu club.';
}

// Qué tarjeta del selector le corresponde a una entrada de allRoles.
// ⚠️ v596 · VIVÍA DENTRO DE showRoleSelection. Se sube al ámbito del módulo
// porque _motivoOpcionBloqueada (la segunda puerta, que corre desde
// selectOption) necesita exactamente el MISMO criterio: si las dos versiones
// divergieran, una tarjeta bloqueada podría abrirse por el otro camino.
function _optionOf(r) {
    const isUnderIndividual = !!(r.individualEntityId || r.isIndividual);
    if (r.role === 'club_admin') return 'clubadmin';
    if (['coach','user'].includes(r.role)) return isUnderIndividual ? 'coach_individual' : 'coach';
    if (['parent','parent_individual','padre_individual'].includes(r.role)) return isUnderIndividual ? 'parent_individual' : 'parent';
    if (['individual','admin_individual'].includes(r.role)) return 'individual';
    return r.role;
}

// ⚠️ UNA OPCIÓN PUEDE VENIR DE VARIAS PLAZAS, y sólo se bloquea si TODAS lo
// están. Quien coordina en dos clubes y sólo uno lo contrata tiene que poder
// entrar: dentro del panel elige el club. Bloquear la tarjeta le quitaría el
// club que sí paga por una decisión del que no.
function _motivoOpcionBloqueada(me, option) {
    if (!me) return '';
    if (['superadmin', 'admin'].includes(me.role)) return '';   // el SA entra a todo por diseño
    const activos = (me.allRoles || [])
        .filter(r => r && r.isAuthorized === true && r.status === 'active');
    const propias = activos.filter(r => _optionOf(r) === option);
    if (propias.length) {
        let motivo = '';
        for (const r of propias) {
            const m = _motivoPlazaBloqueada(r.role, _entidadDeLaPlaza(r));
            if (!m) return '';                                   // una abierta basta
            motivo = motivo || m;
        }
        return motivo;
    }
    // Sin entradas en allRoles: se juzga el rol RAÍZ con el club de la raíz.
    return _motivoPlazaBloqueada(_ROL_DE_OPCION[option] || me.role, me.clubId || '');
}

// Tarjeta del selector → nombre de rol, para poder juzgar el rol raíz y la
// segunda puerta de selectOption sin depender de allRoles.
const _ROL_DE_OPCION = {
    clubadmin:          'club_admin',
    director:           'director',
    coordinator:        'coordinator',
    coach:              'user',
    coach_individual:   'user',
    parent:             'parent',
    parent_individual:  'parent_individual',
    individual:         'individual',
};

// Pinta (o quita) el candado sobre una tarjeta del selector.
// ⚠️ SE GUARDA EL ORIGINAL EN dataset. showRoleSelection se llama muchas
// veces —cada "volver al selector de roles"—: sin guardar el icono y la
// descripción de fábrica, la primera vez que se bloquea la tarjeta se queda
// con el 🔒 y el motivo escritos para siempre, aunque el club lo contrate
// después.
function _aplicarCandadoTarjeta(el, motivo) {
    if (!el) return;
    const icono = el.querySelector('.role-card-icon');
    const desc  = el.querySelector('p');
    if (icono && el.dataset.origIcono === undefined) el.dataset.origIcono = icono.textContent;
    if (desc  && el.dataset.origDesc  === undefined) el.dataset.origDesc  = desc.textContent;

    if (motivo) {
        // 🔑 SE QUITA LA ACCIÓN, no sólo el aspecto. La lección de v548:
        // apagar con CSS deja la función viva para quien pulse igual.
        el.removeAttribute('onclick');
        el.onclick = null;
        el.style.opacity    = '0.45';
        el.style.filter     = 'grayscale(1)';
        el.style.cursor     = 'not-allowed';
        el.style.boxShadow  = 'inset 0 0 0 9999px rgba(0,0,0,0.25)';
        el.setAttribute('title', motivo);
        el.setAttribute('data-bloqueado', '1');
        if (icono) icono.textContent = '🔒';
        if (desc)  desc.textContent  = motivo;
    } else if (el.getAttribute('data-bloqueado')) {
        const opt = String(el.id || '').replace(/^card-opt-/, '').replace(/-/g, '_');
        el.setAttribute('onclick', "selectOption('" + opt + "')");
        el.style.opacity    = '';
        el.style.filter     = '';
        el.style.cursor     = '';
        el.style.boxShadow  = '';
        el.removeAttribute('title');
        el.removeAttribute('data-bloqueado');
        if (icono && el.dataset.origIcono !== undefined) icono.textContent = el.dataset.origIcono;
        if (desc  && el.dataset.origDesc  !== undefined) desc.textContent  = el.dataset.origDesc;
    }
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

    // v596 · `show` pinta además el candado del extra de rol, si lo hay. Se le
    // pasa la OPCIÓN (no el id) porque el motivo se calcula por opción: ver
    // _motivoOpcionBloqueada y su regla de "una plaza abierta basta".
    const show = (id, option) => {
        const el = document.getElementById(id);
        if (!el) return;
        el.style.display = 'block';
        _aplicarCandadoTarjeta(el, option ? _motivoOpcionBloqueada(me, option) : '');
    };

    // 1. Caso SuperAdmin
    if (['superadmin', 'admin'].includes(me.role)) {
        // El SA nunca se bloquea: _motivoOpcionBloqueada ya lo deja pasar, pero
        // se pasa '' explícito para que además se le RETIRE cualquier candado
        // que le quedara puesto de una sesión anterior en el mismo navegador.
        allCards.forEach(id => show(id, ''));
        return;
    }

    // 2. Multi-rol y roles específicos
    // Solo mostrar paneles de roles ACTIVOS (isAuthorized=true AND status='active')
    const activeRoles = (me.allRoles || [])
        .filter(r => r.isAuthorized === true && r.status === 'active');

    // Si sólo hay UNA tarjeta posible, entrar directamente sin enseñar la
    // pantalla de selección.
    // ⚠️ v540 · SE CUENTAN TARJETAS, NO ENTRADAS. Un entrenador con dos
    // equipos (un F7 y un F11, v537) tiene DOS entradas activas que llevan a
    // la MISMA tarjeta: antes se le plantaba una pantalla de "elige tu rol"
    // con una sola opción, que no elige nada. Entre sus dos equipos elige
    // dentro del panel, que es donde sabe cuál es cuál.
    const _opcionesActivas = Array.from(new Set(activeRoles.map(_optionOf)));
    // 🔑 v596 · EL ATAJO NO PUEDE SALTAR POR ENCIMA DEL CANDADO. Si la única
    // opción está bloqueada, entrar directamente la metería en el panel sin
    // pasar por ninguna tarjeta. Se cae al pintado normal: verá SU tarjeta,
    // bloqueada y con el motivo, que es justo lo que hay que decirle.
    if (_opcionesActivas.length === 1 && !_motivoOpcionBloqueada(me, _opcionesActivas[0])) {
        screen.style.display = 'none';
        selectOption(_opcionesActivas[0]);
        return;
    }

    if (activeRoles.length > 0) {
        activeRoles.forEach(r => {
            // Determinar si el rol está bajo una entidad individual
            const isUnderIndividual = !!(r.individualEntityId || r.isIndividual);
            if (r.role === 'club_admin')                        show('card-opt-clubadmin', 'clubadmin');
            else if (r.role === 'director')                     show('card-opt-director', 'director');
            else if (r.role === 'coordinator')                  show('card-opt-coordinator', 'coordinator');
            else if (['coach','user'].includes(r.role))         isUnderIndividual ? show('card-opt-coach-individual', 'coach_individual') : show('card-opt-coach', 'coach');
            else if (['parent','parent_individual','padre_individual'].includes(r.role)) isUnderIndividual ? show('card-opt-parent-individual', 'parent_individual') : show('card-opt-parent', 'parent');
            else if (['individual','admin_individual'].includes(r.role)) show('card-opt-individual', 'individual');
            else if (r.role === 'entrenador_individual')        show('card-opt-coach-individual', 'coach_individual');
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
        if (r === 'club_admin')                        show('card-opt-clubadmin', 'clubadmin');
        else if (r === 'director')                     show('card-opt-director', 'director');
        else if (r === 'coordinator')                  show('card-opt-coordinator', 'coordinator');
        else if (['coach','user'].includes(r))         _isIndiv ? show('card-opt-coach-individual', 'coach_individual') : show('card-opt-coach', 'coach');
        else if (['parent','parent_individual'].includes(r)) _isIndiv ? show('card-opt-parent-individual', 'parent_individual') : show('card-opt-parent', 'parent');
        else if (['individual','admin_individual'].includes(r)) show('card-opt-individual', 'individual');
    }
}

// ── Lanzar App con la opción seleccionada ─────────────────────
export function selectOption(option) {
    const me = window._cronosCurrentUser;
    if (!me) return;

    // ⚠️⚠️ v596 · SEGUNDA PUERTA, Y LA QUE DE VERDAD CIERRA. Quitarle el
    // onclick a la tarjeta no impide llamar a selectOption('director') desde
    // la consola, ni que un `showRoleSelector()` de otro panel repinte antes
    // de que la caché de extras esté lista. Mismo criterio que la primera
    // (_motivoOpcionBloqueada) para que las dos no puedan divergir.
    const _motivo = _motivoOpcionBloqueada(me, option);
    if (_motivo) {
        const txt = '🔒 ' + _motivo;
        if (typeof window.showToast === 'function') window.showToast(txt, 4000);
        else alert(txt);
        const _pantalla = document.getElementById('role-selection-screen');
        if (_pantalla) _pantalla.style.display = 'flex';
        return;
    }

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

        // ══════════════════════════════════════════════════════════════
        //  v540 · EL ENTRENADOR CON DOS EQUIPOS ARRANCA EN EL QUE ELIGIÓ
        //
        //  🔑 Desde v537 un entrenador puede llevar un F7 y un F11 en el
        //  mismo club: eso son DOS entradas 'user' con el mismo clubId, y
        //  el `find` de abajo devuelve SIEMPRE la primera del array. Sin
        //  esto, su segundo equipo era inalcanzable — no había forma de
        //  abrirlo desde ninguna pantalla.
        //
        //  ⚠️ La elección se VALIDA contra los equipos vivos en cada
        //  arranque. Si el equipo elegido ya no es suyo (se lo han
        //  retirado, o cambió de club), `_elegida` sale undefined y se cae
        //  al camino de siempre.
        // ══════════════════════════════════════════════════════════════
        let _elegida;
        if ((role === 'user' || role === 'coach') &&
            typeof window.cronosEquipoElegido === 'function' &&
            typeof window.cronosEquiposDeEntrenador === 'function') {
            const _elegido = window.cronosEquipoElegido();
            if (_elegido) {
                const _eq = window.cronosEquiposDeEntrenador(me.allRoles, null)
                    .find(e => e.teamId === _elegido);
                if (_eq) _elegida = _eq._rol;
            }
        }

        const roleEntry =
            _elegida ||
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
                // ⚠️ v540 · CATEGORÍA Y SUBCATEGORÍA SE ASIGNAN JUNTAS.
                // Antes iban en dos `if` independientes, así que al pasar de
                // "Cadete B" a un equipo sin subcategoría quedaba "Alevín B":
                // media identidad del equipo anterior pegada a la nueva.
                //
                // ⚠️ PERO SÓLO SI LA ENTRADA TRAE CATEGORÍA. Hay perfiles
                // antiguos cuya entrada de allRoles no la tiene y sí la raíz
                // del documento; machacarla con null los dejaría sin equipo.
                // Al cambiar de equipo la entrada siempre la trae, que es el
                // caso que había que arreglar.
                const _catRol = roleEntry.category || roleEntry.categoryLabel || '';
                if (_catRol) {
                    me.category    = _catRol;
                    me.subcategory = roleEntry.subcategory || null;
                }
                // El equipo activo queda anotado para que el selector del
                // panel sepa cuál está abierto (y lo marque).
                if (typeof window.cronosFijarEquipoElegido === 'function' &&
                    typeof cronosTeamId === 'function' && me.category) {
                    window.cronosFijarEquipoElegido(
                        cronosTeamId(roleEntry.clubId || me.clubId || '', me.category, me.subcategory || ''));
                }
                // 🔑 El resto del proyecto lee `_activeRoleData` como respaldo
                // de la categoría (cronosMyTeam y 8 módulos más) y NADIE lo
                // rellenaba en el usuario con la sesión abierta: quedaba
                // siempre undefined y esa rama de la cascada era código muerto.
                me._activeRoleData = roleEntry;
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
            // v596 · Pasa por _cargarExtrasEntidad, la MISMA caché por entidad
            // que usa el selector de rol. Dos ventajas: si enterApp ya los
            // precargó no se vuelve a leer el documento, y `me.extras` no puede
            // decir una cosa distinta de la que decidió el candado de la tarjeta.
            (async () => {
                const clubId2 = roleEntry.clubId || me.clubId;
                if (!clubId2) return;
                const _ex = await _cargarExtrasEntidad(clubId2);
                // ⚠️ null = la lectura FALLÓ. Se deja `me.extras` como estaba en
                // vez de vaciarlo: con `{}` todo sigue activo (`!== false`), pero
                // pisaría unos extras buenos que ya estuvieran cargados.
                if (_ex) me.extras = _ex;
                console.log('[auth] extras del club cargados:', me.extras);
                // FIX: re-renderizar el modal si esta abierto
                if (typeof window._cronosRefreshExtras === 'function') {
                    setTimeout(window._cronosRefreshExtras, 100);
                }
            })();

            // ── Campo exclusivo del rol 'coordinator' (tipo F7/F11/F7&11) ──
            //
            // 🔑 v593 · LA MODALIDAD ES DE LA PLAZA, NO DE LA PERSONA (v540:
            // la unidad es la PLAZA). Alguien puede coordinar el F7 en un club
            // y las dos modalidades en otro. Si la plaza con la que entra NO
            // trae tipo, se BORRA el de la raíz en vez de dejarlo: heredar el
            // de la otra plaza le acotaría el panel por un dato que no es suyo
            // — y acotar de más no se ve, sólo se echa en falta.
            if (role === 'coordinator') {
                me.coordinatorType = roleEntry.coordinatorType || null;
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
        // v593 · Se pregunta al resolutor compartido en vez de mirar sólo el
        // campo raíz: así la pill dice la verdad también cuando la modalidad
        // vive dentro de allRoles[] o llegó como `requestedCoordinatorType`
        // (histórico), que era cuando antes no salía ninguna.
        const ct = (typeof window._cronosStaffCoordinatorType === 'function')
            ? (window._cronosStaffCoordinatorType(me) || (me && me.coordinatorType))
            : (me && me.coordinatorType);
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

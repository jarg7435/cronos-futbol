/**
 * auth.js - Gestión de Autenticación y Autorización
 * Cronos Fútbol — v5.1 (multi-rol sin queries, compatible con firestore rules)
 */

// ── Estado Local ──────────────────────────────────────────────
let _isLoginMode = true;
let _addingRoleTimestamp = 0;
const _ADDING_ROLE_TIMEOUT_MS = 30000; // 30s safety net contra _addingRole estancado

// ── Cambiar entre Login y Registro ──────────────────────────
export async function switchTab(tab) {
    _isLoginMode = (tab === 'login');

    // ── Estilos de las pestañas ──────────────────────────────
    const loginTab = document.getElementById('tab-login');
    const regTab   = document.getElementById('tab-register');
    if (loginTab) {
        loginTab.style.color        = _isLoginMode ? '#58a6ff' : '#7d8590';
        loginTab.style.borderBottom = _isLoginMode ? '2px solid #58a6ff' : '2px solid transparent';
    }
    if (regTab) {
        regTab.style.color        = !_isLoginMode ? '#58a6ff' : '#7d8590';
        regTab.style.borderBottom = !_isLoginMode ? '2px solid #58a6ff' : '2px solid transparent';
    }

    // ── Limpiar mensaje de error ─────────────────────────────
    // No limpiar el error al ir a login (puede haber un mensaje pendiente de ver)
    if (!_isLoginMode) {
        const errorEl = document.getElementById('auth-error');
        if (errorEl) errorEl.textContent = '';
    }

    // ── Mostrar/ocultar sección de contraseña según modo ────
    // En login: solo campo contraseña simple
    // En registro: campos contraseña + confirmar + rol + extras
    const loginPwdSec    = document.getElementById('login-pwd-section');
    const registerPwdSec = document.getElementById('register-pwd-section');
    if (loginPwdSec)    loginPwdSec.style.display    = _isLoginMode ? 'block' : 'none';
    if (registerPwdSec) registerPwdSec.style.display = _isLoginMode ? 'none'  : 'block';

    // ── Mostrar/ocultar selector de rol ──────────────────────
    const roleCont = document.getElementById('role-container');
    if (roleCont) roleCont.style.display = _isLoginMode ? 'none' : 'block';

    // GDPR: mostrar/ocultar consentimiento (solo visible en modo registro)
    const gdprCont = document.getElementById('gdpr-consent-container');
    if (gdprCont) gdprCont.style.setProperty('display', _isLoginMode ? 'none' : 'block', 'important');
    // Resetear el checkbox al volver a login para que el consentimiento sea explicito
    const gdprChk = document.getElementById('gdpr-consent');
    if (gdprChk && _isLoginMode) gdprChk.checked = false;

    // Pie de Política de Privacidad: solo visible en modo login (el modo
    // registro ya tiene el enlace dentro del checkbox de consentimiento).
    const privacyFooter = document.getElementById('privacy-link-footer');
    if (privacyFooter) privacyFooter.style.setProperty('display', _isLoginMode ? 'block' : 'none', 'important');

    // ── Actualizar texto del botón ENTRAR ────────────────────
    const authBtn = document.getElementById('auth-btn');
    if (authBtn) authBtn.textContent = _isLoginMode ? 'ENTRAR' : 'REGISTRARSE';

    // ── RGPD: en modo registro el botón se deshabilita hasta aceptar ──
    // Se conecta el listener una sola vez (idempotente) y se sincroniza
    // el estado del botón con el estado actual del checkbox.
    if (gdprChk && authBtn) {
        if (!gdprChk._gdprWired) {
            gdprChk.addEventListener('change', syncAuthBtnConsent);
            gdprChk._gdprWired = true;
        }
        syncAuthBtnConsent();
    }

    if (!_isLoginMode) {
        // Modo registro: cargar clubes y mostrar campos según rol
        loadClubOptions();
        handleRoleChange();
    } else {
        // Modo login: ocultar todos los campos extra del registro
        ['club-container', 'new-club-container', 'individual-name-container',
         'player-name-container', 'category-container', 'entity-type-container'].forEach(id => {
            const el = document.getElementById(id);
            if (el) el.style.display = 'none';
        });
    }
}

// ── RGPD: habilita/inhabilita #auth-btn según el consentimiento ─────
// En login el botón siempre está activo; en registro requiere el check.
function syncAuthBtnConsent() {
    const authBtn = document.getElementById('auth-btn');
    const gdprChk = document.getElementById('gdpr-consent');
    if (!authBtn) return;
    const disabled = !_isLoginMode && !(gdprChk && gdprChk.checked);
    authBtn.disabled = disabled;
    authBtn.style.opacity = disabled ? '0.5' : '1';
    authBtn.style.cursor  = disabled ? 'not-allowed' : 'pointer';
}

// ── Cargar Clubes y Administradores Individuales en el selector ──────
export async function loadClubOptions() {
    const select = document.getElementById('auth-club-select');
    if (!select) return;

    select.innerHTML = '<option value="">⏳ Cargando opciones...</option>';

    let fa = window._cronos_auth;
    if (!fa) {
        for (let i = 0; i < 8; i++) {
            await new Promise(r => setTimeout(r, 500));
            fa = window._cronos_auth;
            if (fa) break;
        }
    }
    if (!fa || !fa.db) {
        select.innerHTML = '<option value="">⚠️ Firebase no disponible. Recarga la página.</option>';
        return;
    }

    try {
        const m = await import('https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js');

        // Cargar clubs y entes individuales
        let clubsHtml = '';
        let indivHtml = '';
        let clubsLoaded = false;
        let indivLoaded = false;
        try {
            // FIX (SEC-008): leer desde clubs_public (lectura publica, sin
            // autenticacion) en vez de clubs. clubs_public es el espejo que
            // mantiene la Cloud Function syncClubPublic con solo name/type/status,
            // por lo que el formulario de registro funciona para usuarios no
            // autenticados sin exponer los campos sensibles de clubs.
            const clubsSnap = await m.getDocs(m.collection(fa.db, 'clubs_public'));
            if (!clubsSnap.empty) {
                clubsSnap.forEach(doc => {
                    const club = doc.data();
                    if (club.status !== 'blocked') {
                        if (club.type === 'individual') {
                            // Ente individual (clubs con type=individual)
                            const name = club.name || doc.id;
                            indivHtml += '<option value="individual:' + doc.id + '">👤 ' + name + '</option>';
                        } else {
                            // Club normal
                            clubsHtml += '<option value="club:' + doc.id + '">🏟️ ' + (club.name || doc.id) + '</option>';
                        }
                    }
                });
                clubsLoaded = true;
                if (indivHtml) indivLoaded = true;
            }
        } catch(e) {
            console.warn('[Cronos] Error cargando clubs_public:', e.message);
        }

        // Cargar entidades individuales (colección 'individuals' — compatibilidad)
        // FIX: Solo ejecutar si hay usuario autenticado (las rules requieren isAuth())
        try { if (fa.auth && fa.auth.currentUser) {
            const indivSnap = await m.getDocs(m.collection(fa.db, 'individuals'));
            if (!indivSnap.empty) {
                indivSnap.forEach(doc => {
                    const ind = doc.data();
                    if (ind.status !== 'blocked') {
                        // Evitar duplicar si ya se cargó desde clubs
                        if (!indivHtml.includes('value="individual:' + doc.id + '"')) {
                            const name = ind.displayName || ind.email || doc.id;
                            const label = (name !== ind.email) ? name + ' (' + ind.email + ')' : ind.email;
                            const adminTag = ind.hasAdmin ? '' : ' ⏳';
                            indivHtml += '<option value="individual:' + doc.id + '">👤 ' + label + adminTag + '</option>';
                        }
                    }
                });
                indivLoaded = true;
            }
        } } catch(e) {
            console.warn('[Cronos] Error cargando entidades individuales:', e.message);
        }

        // Construir HTML combinado
        if (!clubsLoaded && !indivLoaded) {
            select.innerHTML = '<option value="">No hay clubes ni administradores individuales registrados aún</option>';
            return;
        }

        let html = '<option value="">-- Selecciona --</option>';
        if (clubsHtml) {
            html += '<option value="" disabled style="color:#8b949e;">── Clubes ──</option>';
            html += clubsHtml;
        }
        if (indivHtml) {
            html += '<option value="" disabled style="color:#8b949e;">── Usuarios Individuales ──</option>';
            html += indivHtml;
        }
        select.innerHTML = html;

        // ── Listener: al cambiar el selector de entidad ──
        // ESTRATEGIA: NO intentar leer hasAdmin desde Firestore (falla por permisos
        // cuando el usuario no está autenticado). En su lugar, simplemente habilitar
        // los roles compatibles con el tipo de entidad seleccionada y dejar que
        // doAuth() haga la validación completa de la logística de registro.
        if (!select._indListener) {
            select._indListener = true;
            select.addEventListener('change', async function() {
                const val = this.value;
                const roleSelect = document.getElementById('auth-role');
                if (!roleSelect) return;
                const currentRole = roleSelect.value;

                if (val.startsWith('individual:')) {
                    // ── Se seleccionó una entidad individual ──
                    // Habilitar SOLO los roles compatibles con individual:
                    //   - user (Entrenador Individual)
                    //   - parent (Padre/Madre/Tutor Individual)
                    //   - individual (Administrador Individual)
                    // Deshabilitar roles de club que no aplican
                    const roleOptions = roleSelect.querySelectorAll('option');
                    roleOptions.forEach(opt => {
                        if (['user', 'parent', 'individual'].includes(opt.value)) {
                            opt.disabled = false;
                            opt.style.color = '';
                        } else {
                            opt.disabled = true;
                            opt.style.color = '#4d5566';
                        }
                    });

                    // Si el rol actual no es compatible con individual, cambiar a entrenador
                    if (!['user', 'parent', 'individual'].includes(currentRole)) {
                        roleSelect.value = 'user';
                    }

                    // Sincronizar el selector de tipo de entidad
                    const entityTypeEl = document.getElementById('auth-entity-type');
                    if (entityTypeEl) entityTypeEl.value = 'individual';

                    if (typeof handleRoleChange === 'function') handleRoleChange();

                } else if (val.startsWith('club:') || val === '') {
                    // ── Se seleccionó un club o se deseleccionó ──
                    // Rehabilitar todas las opciones de rol
                    const roleOptions = roleSelect.querySelectorAll('option');
                    roleOptions.forEach(opt => {
                        opt.disabled = false;
                        opt.style.color = '';
                    });

                    // Si el rol era 'individual' (admin individual), restaurar a entrenador
                    if (currentRole === 'individual') {
                        roleSelect.value = 'user';
                    }

                    // Sincronizar el selector de tipo de entidad
                    const entityTypeEl = document.getElementById('auth-entity-type');
                    if (entityTypeEl && val.startsWith('club:')) entityTypeEl.value = 'club';

                    if (typeof handleRoleChange === 'function') handleRoleChange();
                }
            });
        }
    } catch(e) {
        console.error('[Cronos] Error cargando opciones:', e);
        select.innerHTML = '<option value="">⚠️ Error al cargar — actualiza la página</option>';
        setTimeout(() => loadClubOptions(), 2000);
    }
}

// ── Manejar Cambio de Tipo de Entidad (Club vs Individual) ──
export function handleEntityChange() {
    const entityType = document.getElementById('auth-entity-type')?.value;
    const clubSelectEl = document.getElementById('auth-club-select');
    const clubLabel = document.getElementById('auth-club-label');
    const clubHint = document.getElementById('auth-club-hint');
    const roleSelect = document.getElementById('auth-role');
    const currentRole = roleSelect?.value;

    if (entityType === 'individual') {
        // Mostrar selector con solo entidades individuales
        if (clubLabel) clubLabel.textContent = '👤 Selecciona tu Entidad Individual';
        if (clubHint) clubHint.textContent = 'Elige el ente individual configurado por el SuperAdmin.';
        // Deshabilitar opciones de club en el desplegable
        if (clubSelectEl) {
            const options = clubSelectEl.querySelectorAll('option');
            options.forEach(opt => {
                if (opt.value.startsWith('club:') || (opt.value === '' && opt.textContent.includes('Club'))) {
                    opt.style.display = 'none';
                    opt.disabled = true;
                } else {
                    opt.style.display = '';
                    opt.disabled = false;
                }
            });
            // Si la opción seleccionada actualmente es un club, resetear
            if (clubSelectEl.value.startsWith('club:')) {
                clubSelectEl.value = '';
            }
        }
        // Deshabilitar roles que no tienen sentido bajo individual (club_admin, director, coordinator)
        if (roleSelect) {
            const roleOptions = roleSelect.querySelectorAll('option');
            roleOptions.forEach(opt => {
                if (['club_admin', 'director', 'coordinator'].includes(opt.value)) {
                    opt.disabled = true;
                    opt.style.color = '#4d5566';
                } else {
                    opt.disabled = false;
                    opt.style.color = '';
                }
            });
        }
    } else {
        // Mostrar selector con solo clubes
        if (clubLabel) clubLabel.textContent = '🏟️ Selecciona tu Club';
        if (clubHint) clubHint.textContent = '';
        if (clubSelectEl) {
            const options = clubSelectEl.querySelectorAll('option');
            options.forEach(opt => {
                if (opt.value.startsWith('individual:') || (opt.value === '' && opt.textContent.includes('Individual'))) {
                    opt.style.display = 'none';
                    opt.disabled = true;
                } else {
                    opt.style.display = '';
                    opt.disabled = false;
                }
            });
            // Si la opción seleccionada actualmente es un individual, resetear
            if (clubSelectEl.value.startsWith('individual:')) {
                clubSelectEl.value = '';
            }
        }
        // Rehabilitar todos los roles
        if (roleSelect) {
            const roleOptions = roleSelect.querySelectorAll('option');
            roleOptions.forEach(opt => {
                opt.disabled = false;
                opt.style.color = '';
            });
        }
    }
    if (typeof handleRoleChange === 'function') handleRoleChange();
}

// ── Manejar Cambio de Rol ────────────────────────────────────
export function handleRoleChange() {
    const role = document.getElementById('auth-role')?.value;

    const isParent              = (role === 'parent');
    const isClubAdmin           = (role === 'club_admin');
    const isIndividual          = (role === 'individual');
    const isEntrenador          = (role === 'user');
    // Detectar si se seleccionó una entidad individual del desplegable
    const clubSelectEl          = document.getElementById('auth-club-select');
    const isUnderIndividual     = clubSelectEl ? clubSelectEl.value.startsWith('individual:') : false;
    // Detectar tipo de entidad seleccionado
    const entityTypeEl          = document.getElementById('auth-entity-type');
    const entityType            = entityTypeEl ? entityTypeEl.value : '';

    // ── Mostrar entity-type-container para entrenador y padre ──
    // Solo si el rol es entrenador o padre, preguntar si es para club o individual
    const entityTypeCont        = document.getElementById('entity-type-container');
    if (entityTypeCont) {
        if (isEntrenador || isParent) {
            entityTypeCont.style.display = 'block';
        } else {
            entityTypeCont.style.display = 'none';
        }
    }

    // No mostrar club para: club_admin (tiene su propio campo)
    // Individual: el club/entidad se selecciona del desplegable
    const noClub                = isClubAdmin;

    // Para entrenador/padre bajo individual, el selector de entidad se muestra
    // SIEMPRE que no sea club_admin o individual (que tienen su propio flujo)
    const needsClubSelect = !isClubAdmin;

    // Actualizar hint del nombre según el rol
    const nameHint = document.getElementById('individual-name-hint');
    const nameLabel = document.getElementById('individual-name-label');
    if (nameHint && nameLabel) {
        if (isIndividual) {
            nameLabel.textContent = '👤 Tu nombre (Administrador Individual)';
            nameHint.textContent = 'Este nombre será tu identificador. Ej: «Juan», «María»';
            nameHint.style.display = 'block';
        } else if (isClubAdmin) {
            nameLabel.textContent = '👤 Nombre del Administrador';
            nameHint.textContent = 'Tu nombre para identificarte en el club';
            nameHint.style.display = 'block';
        } else {
            nameLabel.textContent = '👤 Nombre';
            nameHint.style.display = 'none';
        }
    }
    // Categoría para entrenador de club, padre, y roles bajo individual
    const needsCategory = ['user', 'parent'].includes(role) || (isUnderIndividual && ['user','parent'].includes(role));

    const clubCont       = document.getElementById('club-container');
    const newClubCont    = document.getElementById('new-club-container');
    const playerCont     = document.getElementById('player-name-container');
    const indivCont      = document.getElementById('individual-name-container');
    const catCont        = document.getElementById('category-container');
    const indOwnerCont   = document.getElementById('individual-owner-container');

    if (clubCont)      clubCont.style.display      = needsClubSelect ? 'block' : 'none';
    if (newClubCont)   newClubCont.style.display    = isClubAdmin ? 'block' : 'none';
    // Nombre del jugador: visible para padre (tanto en club como individual)
    const isParentOrUnderIndiv = isParent;
    if (playerCont)    playerCont.style.display     = isParentOrUnderIndiv ? 'block' : 'none';
    const inviteCont     = document.getElementById('invite-code-container');
    if (inviteCont)    inviteCont.style.display     = 'none'; // FIX: el entrenador asigna el código; el padre no puede elegirlo
    // Nombre y Apellidos: SIEMPRE visible para todos los roles
    if (indivCont)     indivCont.style.display      = 'block';
    // Categoría: entrenador, padre, y sub-usuarios individual
    if (catCont)       catCont.style.display        = needsCategory ? 'block' : 'none';
    // Tipo de Coordinador (F7/F11/F7&11): visible solo para rol 'coordinator'
    const coordTypeCont = document.getElementById('auth-coordinator-type-container');
    if (coordTypeCont) coordTypeCont.style.display = (role === 'coordinator') ? 'block' : 'none';
    const coordTypeEl = document.getElementById('auth-coordinator-type');
    if (coordTypeEl && role !== 'coordinator') coordTypeEl.value = '';
    // Campo email del administrador individual: NO necesario si ya se seleccionó del desplegable
    // Solo mostrar si el usuario necesita buscar al individual manualmente
    if (indOwnerCont)  indOwnerCont.style.display   = 'none';
    const subcatEl = document.getElementById('auth-subcat');
    if (subcatEl && !needsCategory) subcatEl.value = '';

    // ── Filtrar opciones del selector de club/individual según el tipo ──
    // Aplicar el filtro de visibilidad según entityType
    if (entityTypeCont && (isEntrenador || isParent) && clubSelectEl) {
        // Si no hay tipo de entidad seleccionado, mostrar todo por defecto
        // (se filtrará cuando el usuario elija Club o Individual)
        if (entityType === 'individual') {
            // Solo mostrar entidades individuales
            if (clubCont) {
                const clubLabel = document.getElementById('auth-club-label');
                const clubHint = document.getElementById('auth-club-hint');
                if (clubLabel) clubLabel.textContent = '👤 Selecciona tu Entidad Individual';
                if (clubHint) clubHint.textContent = 'Elige el ente individual configurado por el SuperAdmin.';
            }
        } else if (entityType === 'club') {
            if (clubCont) {
                const clubLabel = document.getElementById('auth-club-label');
                const clubHint = document.getElementById('auth-club-hint');
                if (clubLabel) clubLabel.textContent = '🏟️ Selecciona tu Club';
                if (clubHint) clubHint.textContent = '';
            }
        }
    } else if (isIndividual && clubCont) {
        // Para admin individual, el selector muestra solo entidades individuales
        const clubLabel = document.getElementById('auth-club-label');
        const clubHint = document.getElementById('auth-club-hint');
        if (clubLabel) clubLabel.textContent = '👤 Selecciona tu Entidad Individual';
        if (clubHint) clubHint.textContent = 'Selecciona el ente individual que el SuperAdmin configuró para ti.';
    } else if (clubCont) {
        const clubLabel = document.getElementById('auth-club-label');
        if (clubLabel) clubLabel.textContent = '🏟️ Selecciona tu Club';
    }
}

// ── Mostrar Error / Éxito ────────────────────────────────────
export function showAuthError(msg) {
    const el = document.getElementById('auth-error');
    if (el) {
        el.textContent = msg;
        el.style.color = (msg.startsWith('✅') || msg.includes('correct'))
            ? '#3fb950' : '#ff5858';
    }
}

// ── Verificación de Autorización ────────────────────────────
// SUPERADMIN_EMAILS se carga dinámicamente desde Firestore (cronos_config/superadmins)
let SUPERADMIN_EMAILS = [];

// ── Cargar lista de superadmins desde Firestore ──
let _superAdminLoaded = false;
async function loadSuperAdminEmails() {
    try {
        const fa = window._cronos_auth;
        if (!fa || !fa.db) { setTimeout(loadSuperAdminEmails, 1000); return; }
        const snap = await fa.getDoc(fa.doc(fa.db, 'cronos_config', 'superadmins'));
        if (snap.exists()) {
            const data = snap.data();
            SUPERADMIN_EMAILS = data.emails || [];
            _superAdminLoaded = true;
            // SECURITY FIX (SEC-M02): Removed log that exposed superadmin email count
            // 
        } else {
            console.warn('[Cronos] No se encontró cronos_config/superadmins en Firestore');
            _superAdminLoaded = true; // Doc no existe pero ya lo intentamos
        }
    } catch(e) {
        // Si falla por permisos (usuario no autenticado aún), reintentar tras auth
        // Permisos insuficientes = comportamiento esperado antes del login. Silencioso.
        if (e.code !== 'permission-denied' && !(e.message && e.message.includes('permission'))) {
            console.error('[Cronos] Error cargando superadmin emails:', e);
        }
    }
}
loadSuperAdminEmails();

// ── Auto-crear cronos_config/superadmins si no existe ──
// Llamado cuando un superadmin se autentica exitosamente.
// Garantiza que las reglas de Firestore puedan verificarlo vía isSuperAdminEmail().
async function _ensureSuperAdminConfig(email) {
    try {
        const fa = window._cronos_auth;
        if (!fa || !fa.db) return;
        const configRef = fa.doc(fa.db, 'cronos_config', 'superadmins');
        const configSnap = await fa.getDoc(configRef);

        if (configSnap.exists()) {
            const data = configSnap.data();
            const emails = data.emails || [];
            if (!emails.includes(email)) {
                // Añadir el email del SA actual a la lista existente
                await fa.setDoc(configRef, { emails: [...emails, email] }, { merge: true });
                // SECURITY FIX (SEC-M02): Removed log that exposed superadmin email
                // 
            }
            // Actualizar la lista local también
            SUPERADMIN_EMAILS = [...(data.emails || []), email];
            _superAdminLoaded = true;
        } else {
            // Crear el documento con el email del SA actual
            await fa.setDoc(configRef, { emails: [email] });
            SUPERADMIN_EMAILS = [email];
            _superAdminLoaded = true;
            // SECURITY FIX (SEC-M02): Removed log that exposed superadmin email
            // 
        }
    } catch (e) {
        console.warn('[Cronos] _ensureSuperAdminConfig error:', e.message);
        // Si falla por permisos, las nuevas reglas de Firestore lo solucionarán
        // tras el próximo deploy. No bloquear el login.
    }
}

// ── Reintentar carga de config tras autenticación ──
// Esto asegura que loadSuperAdminEmails y loadAccessCode
// se ejecuten DESPUÉS de que el usuario esté autenticado.
window._retryConfigLoadAfterAuth = function() {
    if (!_superAdminLoaded) loadSuperAdminEmails();
    if (typeof window._retryAccessCodeLoad === 'function') window._retryAccessCodeLoad();
};

export async function checkAuthorization(user) {
    if (!user) return;
    const fa = window._cronos_auth;
    if (!fa) return;

    // ── CRÍTICO: Reintentar carga de config ahora que el usuario está autenticado ──
    if (typeof window._retryConfigLoadAfterAuth === 'function') {
        window._retryConfigLoadAfterAuth();
    }

    // Si se está añadiendo un rol, no interferir (solo si hay un usuario activo)
    // Race condition safety: si _addingRole lleva más de 30s, resetearlo
    if (window._addingRole && user) {
        const elapsed = Date.now() - _addingRoleTimestamp;
        if (elapsed > _ADDING_ROLE_TIMEOUT_MS) {
            console.warn('[Cronos] _addingRole estancado (' + Math.round(elapsed/1000) + 's). Reseteando...');
            window._addingRole = false;
            _addingRoleTimestamp = 0;
        } else {
            return;
        }
    }

    try {
        // ── Leer SOLO el documento principal (por uid) ─────────
        // Esto siempre está permitido por la regla: request.auth.uid == userId
        // PERO si las reglas están rotas (por documento inexistente en isSuperAdminEmail),
        // puede fallar con permission-denied. En ese caso, reintentar una vez.
        const ref  = fa.doc(fa.db, 'users', user.uid);
        const _mainTimeout = new Promise((_, reject) =>
            setTimeout(() => reject(new Error('[Cronos] Firestore no responde. Comprueba tu conexión.')), 4000)
        );
        let snap;
        try {
            snap = await Promise.race([fa.getDoc(ref), _mainTimeout]);
        } catch(primaryErr) {
            // Si es error de permisos, las reglas pueden estar fallando por el
            // documento cronos_config/superadmins inexistente. Reintentar tras 1s.
            if (primaryErr.code === 'permission-denied' || (primaryErr.message||'').includes('permission')) {
                console.warn('[Cronos] Primera lectura de usuario falló (permisos), reintentando en 1s...');
                await new Promise(r => setTimeout(r, 1000));
                const _retryTimeout = new Promise((_, reject) =>
                    setTimeout(() => reject(new Error('[Cronos] Firestore no responde tras reintento.')), 6000)
                );
                snap = await Promise.race([fa.getDoc(ref), _retryTimeout]);
            } else {
                throw primaryErr; // Otro error (timeout, red, etc.) → propagar
            }
        }

        // ── CASO 1: Documento NO existe ─────────────────────────
        if (!snap.exists()) {
            if (SUPERADMIN_EMAILS.includes(user.email)) {
                await fa.setDoc(ref, {
                    email:        user.email,
                    role:         'superadmin',
                    isAuthorized: true,
                    status:       'active',
                    createdAt:    fa.serverTimestamp(),
                    lastLogin:    fa.serverTimestamp(),
                    autoRecovered: true,
                    allRoles: [{ role: 'superadmin', clubId: null, clubName: null, isAuthorized: true }],
                });
                window._cronosCurrentUser = {
                    uid:     user.uid,
                    email:   user.email,
                    role:    'superadmin',
                    clubId:  null,
                    clubName: null,
                };
                // [Cronos-Privacy] Purga PII local del usuario anterior si cambió el uid.
                if (typeof window._purgeStaleLocalDataIfNeeded === 'function') window._purgeStaleLocalDataIfNeeded(user.uid);
                enterApp();
                return;
            }

            // ── Buscar entidad individual donde este email es el admin ──
            // Si el usuario se registra como admin individual y la entidad existe,
            // se le asocia automáticamente.
            try {
                const { collection, getDocs, query, where, setDoc, doc, updateDoc, serverTimestamp } =
                    await import('https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js');

                // Buscar entidad individual donde este email es el admin
                // Buscar en clubs (type=individual) primero, luego en individuals
                let indDoc = null;
                let indData = null;
                let indCollection = null;

                try {
                    const clubsSnap = await getDocs(collection(fa.db, 'clubs'));
                    clubsSnap.forEach(d => {
                        const c = d.data();
                        if (c.type === 'individual' && (c.adminEmail === user.email || c.email === user.email)) {
                            if (!indDoc) { indDoc = d; indData = c; indCollection = 'clubs'; }
                        }
                    });
                } catch(_) {}

                if (!indDoc) {
                    try {
                        const indSnap = await getDocs(
                            query(collection(fa.db, 'individuals'), where('email', '==', user.email))
                        );
                        indSnap.forEach(d => {
                            const ind = d.data();
                            if (!indDoc) { indDoc = d; indData = ind; indCollection = 'individuals'; }
                        });
                    } catch(_) {}
                }

                if (indDoc && indData) {

                    // Crear documento de usuario como admin individual
                    const fullName = indData.displayName || indData.name || user.email.split('@')[0];
                    const migratedData = {
                        email:           user.email,
                        role:            'individual',
                        isAuthorized:    true,
                        status:          'active',
                        displayName:     'Administrador Individual ' + fullName,
                        firstName:       indData.displayName || indData.name || null,
                        lastName:        null,
                        plan:            indData.plan || 'free',
                        isIndividual:    true,
                        individualEntityId: indDoc.id,
                        individualOwnerId:  indDoc.id,
                        // CRITICAL: clubId always = entityId for SuperAdmin panel compatibility
                        clubId:          indDoc.id,
                        allRoles:        [{
                            role: 'individual',
                            isAuthorized: true,
                            status: 'active',
                            individualEntityId: indDoc.id,
                            clubId: indDoc.id,
                        }],
                        approvedBySA:    true,
                        createdAt:       serverTimestamp(),
                        lastLogin:       serverTimestamp(),
                    };

                    await setDoc(doc(fa.db, 'users', user.uid), migratedData);

                    // Actualizar la entidad para marcar que ya tiene admin
                    await updateDoc(doc(fa.db, indCollection, indDoc.id), {
                        hasAdmin: true,
                        adminUid: user.uid,
                        adminEmail: user.email,
                        adminName: indData.displayName || indData.name || user.email,
                    });

                    window._cronosCurrentUser = {
                        uid:     user.uid,
                        email:   user.email,
                        role:    'individual',
                        clubId:  null,
                        clubName: null,
                    };
                    // [Cronos-Privacy] Purga PII local del usuario anterior si cambió el uid.
                    if (typeof window._purgeStaleLocalDataIfNeeded === 'function') window._purgeStaleLocalDataIfNeeded(user.uid);
                    enterApp();
                    return;
                }
            } catch(preErr) {
                console.warn('[Cronos] Error buscando entidad individual:', preErr.message);
            }

            await fa.signOut(fa.auth);
            showAuthError(
                '⚠️ Tu cuenta no está registrada en el sistema. ' +
                'Si ya te registraste y fuiste dado de baja, ' +
                'puedes volver a registrarte con el mismo email.'
            );
            return;
        }

        const data = snap.data();

        // ════════════════════════════════════════════════════════════
        // SUPERADMIN BYPASS — CRITICAL FIX
        // ────────────────────────────────────────────────────────────
        // Si el usuario es superadmin (por email en SUPERADMIN_EMAILS,
        // por custom claim role='superadmin', o por role en el documento),
        // forzamos isAuthorized=true y status='active' ANTES de que
        // los CASO 2-4 puedan bloquearlo.
        //
        // Esto resuelve el bug donde un superadmin cuyo documento en
        // Firestore tenía isAuthorized:false o status:'pending' quedaba
        // atrapado en "Acceso pendiente de aprobación".
        //
        // También auto-corregimos el documento en Firestore para
        // sincronizarlo con el estado real del superadmin.
        // ════════════════════════════════════════════════════════════
        let _isSuperAdmin = SUPERADMIN_EMAILS.includes(user.email) ||
                            data.role === 'superadmin';

        // Verificar también custom claims si están disponibles
        if (!_isSuperAdmin) {
            try {
                const _idTokenResult = await user.getIdTokenResult(true); // SECURITY FIX (SEC-M01): Force token refresh
                if (_idTokenResult && _idTokenResult.claims && _idTokenResult.claims.role === 'superadmin') {
                    _isSuperAdmin = true;
                }
            } catch(_) { /* No bloquear si falla la verificación de token */ }
        }

        if (_isSuperAdmin) {
            // Corregir el documento de Firestore si está desincronizado
            const _needsFix = !data.isAuthorized || data.status !== 'active' || data.role !== 'superadmin';
            if (_needsFix) {
                // SECURITY FIX (SEC-M02): Removed log that exposed user email in SA context
                // 
                try {
                    await fa.setDoc(ref, {
                        isAuthorized: true,
                        status: 'active',
                        role: 'superadmin',
                        lastLogin: fa.serverTimestamp(),
                    }, { merge: true });
                } catch(fixErr) {
                    console.warn('[Cronos] SuperAdmin bypass: no se pudo corregir el documento:', fixErr.message);
                }
            }
            // Forzar valores en memoria para el resto del flujo
            data.isAuthorized = true;
            data.status = 'active';
            data.role = 'superadmin';

            // Asegurar que SUPERADMIN_EMAILS incluye a este usuario
            if (!SUPERADMIN_EMAILS.includes(user.email)) {
                SUPERADMIN_EMAILS.push(user.email);
            }

            // Asegurar que cronos_config/superadmins existe y contiene este email
            _ensureSuperAdminConfig(user.email).catch(e =>
                console.warn('[Cronos] No se pudo actualizar cronos_config/superadmins:', e.message)
            );

            // SECURITY FIX (SEC-M02): Removed log that exposed superadmin email
            // 
        }
        // ═══════ FIN SUPERADMIN BYPASS ═════════════════════════════

        // ── CASO 2: Cuenta eliminada ───────────────────────────
        if (data.status === 'removed') {
            await fa.signOut(fa.auth);
            showAuthError(
                '🔄 Tu cuenta fue dada de baja. ' +
                'Puedes registrarte de nuevo con el mismo email.'
            );
            return;
        }

        // ── CASO 3: Cuenta bloqueada ───────────────────────────
        if (data.status === 'blocked') {
            await fa.signOut(fa.auth);
            showAuthError('🔒 Cuenta bloqueada. Contacta con tu administrador.');
            return;
        }

        // ── CASO 3b: Pendiente de aprobación ─────────────────────────────
        if (data.status === 'pending_club_admin' || data.status === 'pending_sa' || data.status === 'pending' || data.status === 'pending_individual') {
            // Verificar si el SA ya aprobó alguna platform_request para este usuario
            // Buscar en Firestore por userUid en lugar de por ID fijo
            try {
                const { collection, getDocs, query, where } =
                    await import('https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js');

                // Consulta simple por userUid con timeout de 8s (redes móviles lentas / QUIC)
                const _t1 = new Promise(r => setTimeout(() => r(null), 8000));
                const allUserReqs = await Promise.race([
                    getDocs(query(collection(fa.db, 'platform_requests'),
                                  where('userUid', '==', user.uid))),
                    _t1
                ]);
                if (!allUserReqs) throw new Error('[Cronos] Timeout platform_requests (pending)');

                // Filtrar los aprobados por SA en JS
                const approvedDocs = [];
                allUserReqs.forEach(d => {
                    const s = d.data().status;
                    if (s === 'sa_approved' || s === 'approved' || s === 'active') {
                        approvedDocs.push(d);
                    }
                });

                // Crear objeto iterable compatible
                const approvedSnap = {
                    empty: approvedDocs.length === 0,
                    docs: approvedDocs,
                    forEach: (fn) => approvedDocs.forEach(fn),
                };

                if (!approvedSnap.empty) {
                    // SA aprobó — activar el usuario automáticamente

                    // Encontrar la plataform_request más reciente
                    let bestReq = null;
                    approvedSnap.forEach(d => {
                        const req = d.data();
                        if (!bestReq || req.approvedAt > (bestReq.approvedAt || '')) {
                            bestReq = { id: d.id, ...req };
                        }
                    });

                    // Construir allRoles activados
                    const currentRoles = data.allRoles || [];
                    const updatedRoles = currentRoles.map(r => {
                        // Activar si coincide con alguna request aprobada
                        const matchingReq = [...approvedSnap.docs].find(d => {
                            const req = d.data();
                            return req.requestedRole === r.role &&
                                   (req.clubId || null) === (r.clubId || null) &&
                                   (req.individualOwnerId || null) === (r.individualEntityId || null);
                        });
                        if (matchingReq) {
                            const rd = matchingReq.data();
                            return { ...r, isAuthorized: true, status: 'active',
                                     clubId: rd.clubId || r.clubId || null,
                                     clubName: rd.clubName || rd.requestedClubName || r.clubName || null };
                        }
                        return r;
                    });

                    // Si ningún rol coincidió (rol no estaba en allRoles), añadirlo
                    approvedSnap.forEach(d => {
                        const req = d.data();
                        const exists = updatedRoles.some(r =>
                            r.role === req.requestedRole && (r.clubId||null) === (req.clubId||null)
                        );
                        if (!exists) {
                            updatedRoles.push({
                                role: req.requestedRole, isAuthorized: true, status: 'active',
                                clubId: req.clubId || null,
                                clubName: req.clubName || req.requestedClubName || null,
                            });
                        }
                    });

                    // Actualizar el doc del usuario
                    const updateObj = {
                        status: 'active', isAuthorized: true, allRoles: updatedRoles,
                        authorizedAt: new Date().toISOString(),
                    };
                    // Si es club_admin, propagar clubId al doc raíz
                    const clubAdminRole = updatedRoles.find(r => r.role === 'club_admin' && r.isAuthorized);
                    if (clubAdminRole?.clubId) {
                        updateObj.clubId   = clubAdminRole.clubId;
                        updateObj.clubName = clubAdminRole.clubName || '';
                        updateObj.role     = 'club_admin';
                    }
                    // Si es individual (Administrador Individual), propagar individualEntityId y clubId
                    const individualRole = updatedRoles.find(r => r.role === 'individual' && r.isAuthorized);
                    if (individualRole) {
                        const _indEntityId = bestReq?.individualOwnerId || bestReq?.clubId
                            || individualRole.clubId || individualRole.individualEntityId
                            || data.individualEntityId || data.clubId || null;
                        if (_indEntityId) {
                            updateObj.clubId              = _indEntityId;
                            updateObj.individualEntityId  = _indEntityId;
                            updateObj.individualOwnerId   = _indEntityId;
                        }
                        // Actualizar la entidad individual: marcar hasAdmin=true
                        try {
                            const { doc, updateDoc } = await import('https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js');
                            if (_indEntityId) {
                                await updateDoc(doc(fa.db, 'clubs', _indEntityId), {
                                    hasAdmin: true,
                                    adminUid: user.uid,
                                    adminEmail: user.email,
                                    adminName: data.displayName || data.firstName || user.email,
                                }).catch(() => {});
                            }
                        } catch(_) {}
                    }

                    await fa.setDoc(ref, updateObj, { merge: true });

                    showAuthError('✅ Acceso aprobado. Iniciando sesión...');
                    setTimeout(() => location.reload(), 1200);
                    return;
                }
            } catch (_activErr) {
                console.warn('[Cronos] Error al verificar aprobación SA:', _activErr);
            }

            // No hay aprobación del SA todavía
            await fa.signOut(fa.auth);

            // Mensaje diferente según el rol principal y el estado
            const mainRole = data.role || (data.allRoles?.[0]?.role) || '';
            const isClubAdminOrIndiv = mainRole === 'club_admin' || mainRole === 'individual';

            const isUnderIndividual = !!(data.individualEntityId || data.individualOwnerId);
            if (data.status === 'pending_individual') {
                showAuthError('⏳ Tu solicitud está pendiente. El Administrador Individual debe revisarla y reenviarla al SuperAdmin.');
            } else if (isClubAdminOrIndiv) {
                showAuthError('⏳ Tu solicitud de registro está pendiente de aprobación por el SuperAdmin.');
            } else if (data.status === 'pending_sa') {
                showAuthError('⏳ Tu solicitud fue reenviada al SuperAdmin. Espera la confirmación.');
            } else if (isUnderIndividual) {
                showAuthError('⏳ Acceso pendiente. El Administrador Individual debe reenviar tu solicitud al SuperAdmin.');
            } else {
                showAuthError('⏳ Acceso pendiente. El administrador de tu club debe reenviar tu solicitud al SuperAdmin.');
            }
            return;
        }


        // ── CASO 4: Pendiente de aprobación ────────────────────
        if (!data.isAuthorized) {
            await fa.signOut(fa.auth);
            const _isUnderIndiv2 = !!(data.individualEntityId || data.individualOwnerId);
            if (_isUnderIndiv2) {
                showAuthError(
                    '⏳ Acceso pendiente de aprobación. ' +
                    'El Administrador Individual debe confirmar tu acceso.'
                );
            } else {
                showAuthError(
                    '⏳ Acceso pendiente de aprobación. ' +
                    'El administrador de tu club debe confirmar tu acceso.'
                );
            }
            return;
        }

        // ── Obtener todos los roles desde allRoles ──────────────
        // Compatibilidad: si no existe allRoles, construir desde el documento
        let allRoles = data.allRoles || [{
            role:        data.role,
            clubId:      data.clubId      || null,
            clubName:    data.clubName    || null,
            isAuthorized: data.isAuthorized || (data.role === 'superadmin'),
            firstName:   data.firstName   || null,
            lastName:    data.lastName    || null,
            displayName: data.displayName || null,
        }];

        // CRÍTICO: Sincronizar roles autorizados entre raíz y allRoles
        // Si el usuario tiene un rol autorizado en la raíz, debe estarlo en allRoles
        // SEGURIDAD (anti-escalada multi-rol): desde el fix de reglas que
        // permite al usuario añadir roles a su propio 'allRoles', NO podemos
        // confiar en el flag 'isAuthorized' de cada entrada de 'allRoles'
        // (un atacante podría ponerlo a true por consola). Solo se considera
        // un rol REALMENTE autorizado si su clave está en _verifiedRoleKeys,
        // sembrado desde fuentes que el usuario NO puede falsificar:
        //   1. RAÍZ del doc (data.isAuthorized/role/clubId) — protegida por reglas.
        //   2. platform_requests aprobadas (status solo escribible por el SA).
        const _roleKey = (role, clubId, indivId) =>
            (role || '') + '|' + (clubId || indivId || '');
        const _verifiedRoleKeys = new Set();
        // Se pone a true solo si la consulta de verificación (platform_requests)
        // se completó. Si falla/timeout, el filtro hace FAIL-OPEN para no
        // bloquear roles legítimos ya activados en sesiones anteriores.
        let _verificationLoaded = false;
        if (data.isAuthorized && data.role) {
            _verifiedRoleKeys.add(_roleKey(data.role, data.clubId, data.individualEntityId));
        }

        if (data.isAuthorized && data.role) {
            let needsRoleSync = false;
            const existingRole = allRoles.find(r => r.role === data.role && (r.clubId || null) === (data.clubId || null));
            if (!existingRole) {
                allRoles.push({
                    role: data.role,
                    clubId: data.clubId || null,
                    clubName: data.clubName || '',
                    isAuthorized: true,
                    status: 'active'
                });
                needsRoleSync = true;
            } else if (!existingRole.isAuthorized) {
                allRoles = allRoles.map(r => 
                    (r.role === data.role && (r.clubId || null) === (data.clubId || null))
                    ? { ...r, isAuthorized: true, status: 'active' } : r
                );
                needsRoleSync = true;
            }
            if (needsRoleSync) {
                fa.setDoc(ref, { allRoles }, { merge: true }).catch(() => {});
            }
        }

        // ── Auto-activar roles aprobados por el SA ──────────────────────
        // Si hay platform_requests con status:'sa_approved' para este usuario,
        // activar el rol en allRoles aunque la actualización anterior fallara
        try {
            const { collection, getDocs, query, where, updateDoc, setDoc } =
                await import('https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js');

            // Consulta simple con timeout de 8s (redes móviles lentas / QUIC)
            const _t2 = new Promise(r => setTimeout(() => r(null), 8000));
            const allReqsSnap = await Promise.race([
                getDocs(query(collection(fa.db, 'platform_requests'),
                              where('userUid', '==', user.uid))),
                _t2
            ]);
            if (!allReqsSnap) throw new Error('[Cronos] Timeout platform_requests (auto-activar)');
            const approvedReqDocs = [];
            _verificationLoaded = true; // verificación disponible
            allReqsSnap.forEach(d => {
                const s = d.data().status;
                if (s === 'sa_approved' || s === 'approved' || s === 'active') approvedReqDocs.push(d);
            });
            const approvedReqs = {
                empty: approvedReqDocs.length === 0,
                docs: approvedReqDocs,
                forEach: (fn) => approvedReqDocs.forEach(fn),
            };

            if (!approvedReqs.empty) {
                let needsUpdate = false;
                const updatedAllRoles = [...allRoles];

                approvedReqs.forEach(reqDoc => {
                    const req = reqDoc.data();
                    const role = req.requestedRole;
                    const clubId = req.clubId || null;
                    const clubName = req.clubName || req.requestedClubName || null;
                    const indivEntityId = req.individualOwnerId || null;
                    // Rol respaldado por platform_request aprobada por el SA → verificado.
                    _verifiedRoleKeys.add(_roleKey(role, clubId, indivEntityId));

                    // Buscar si el rol ya está activo
                    const existingIdx = updatedAllRoles.findIndex(r =>
                        r.role === role && (r.clubId || null) === clubId && (r.individualEntityId || null) === indivEntityId
                    );

                    if (existingIdx === -1) {
                        // Añadir el rol si no existe
                        updatedAllRoles.push({
                            role, isAuthorized: true, status: 'active',
                            clubId: clubId, clubName: clubName,
                        });
                        needsUpdate = true;
                    } else if (!updatedAllRoles[existingIdx].isAuthorized) {
                        // Activar el rol si estaba pendiente
                        updatedAllRoles[existingIdx] = {
                            ...updatedAllRoles[existingIdx],
                            isAuthorized: true, status: 'active',
                            clubId: clubId || updatedAllRoles[existingIdx].clubId,
                            clubName: clubName || updatedAllRoles[existingIdx].clubName,
                        };
                        needsUpdate = true;
                    }
                });

                if (needsUpdate) {
                    allRoles = updatedAllRoles;
                    // También actualizar clubId principal si es club_admin
                    const clubAdminRole = updatedAllRoles.find(r => r.role === 'club_admin' && r.isAuthorized);
                    const updateData = { allRoles: updatedAllRoles, isAuthorized: true, status: 'active' };
                    if (clubAdminRole?.clubId && !data.clubId) {
                        updateData.clubId   = clubAdminRole.clubId;
                        updateData.clubName = clubAdminRole.clubName || data.clubName || '';
                    }
                    // Si es individual (Administrador Individual), propagar individualEntityId y clubId
                    const _indivRole2 = updatedAllRoles.find(r => r.role === 'individual' && r.isAuthorized);
                    if (_indivRole2) {
                        const _indEntId2 = _indivRole2.clubId || _indivRole2.individualEntityId
                            || data.individualEntityId || data.clubId || null;
                        if (_indEntId2) {
                            updateData.clubId              = _indEntId2;
                            updateData.individualEntityId  = _indEntId2;
                            updateData.individualOwnerId   = _indEntId2;
                        }
                        // Actualizar la entidad: marcar hasAdmin=true
                        try {
                            const { doc: _doc2, updateDoc: _updDoc2 } = await import('https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js');
                            if (_indEntId2) {
                                await _updDoc2(_doc2(fa.db, 'clubs', _indEntId2), {
                                    hasAdmin: true,
                                    adminUid: user.uid,
                                    adminEmail: user.email,
                                    adminName: data.displayName || data.firstName || user.email,
                                }).catch(() => {});
                            }
                        } catch(_) {}
                    }
                    await fa.setDoc(ref, updateData, { merge: true }).catch(() => {});
                }
            }
        } catch (_saErr) {
            // No bloquear el login si esto falla
        }

        // ── Limpiar roles huérfanos Y duplicados ────────────────────────
        try {
            const rolesWithClub = allRoles.filter(r => r.clubId && r.role !== 'superadmin');
            if (rolesWithClub.length > 0) {
                const { collection, getDocs } = await import(
                    'https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js'
                );
                const _t3 = new Promise(r => setTimeout(() => r(null), 8000));
                const clubsSnap = await Promise.race([
                    getDocs(collection(fa.db, 'clubs')),
                    _t3
                ]);
                if (!clubsSnap) throw new Error('[Cronos] Timeout clubs (cleanup)');
                const validClubIds = new Set();
                clubsSnap.forEach(d => validClubIds.add(d.id));

                // 1. Filtrar clubes que ya no existen
                let cleanedRoles = allRoles.filter(r => {
                    if (!r.clubId) return true;
                    return validClubIds.has(r.clubId);
                });

                // 2. Eliminar duplicados (mismo role + clubId/individualEntityId)
                // FIX: Considerar individualEntityId además de clubId para deduplicación
                const seenOrphan = new Set();
                cleanedRoles = cleanedRoles.filter(r => {
                    const k = (r.role||'') + '|' + (r.clubId || r.individualEntityId || '');
                    if (seenOrphan.has(k)) return false;
                    seenOrphan.add(k);
                    return true;
                });

                if (cleanedRoles.length !== allRoles.length) {
                    allRoles = cleanedRoles;
                    fa.setDoc(ref, { allRoles: cleanedRoles }, { merge: true }).catch(() => {});
                }
            }
        } catch (_) {}

        // Filtrar solo roles autorizados y ELIMINAR DUPLICADOS
        // (mismo role + clubId/individualEntityId puede aparecer múltiple veces por intentos de registro anteriores)
        // SEGURIDAD: un rol cuenta como autorizado si (a) es superadmin, o
        // (b) su clave está verificada (RAÍZ del doc o platform_request
        // aprobada por el SA). Esto neutraliza la auto-escalada vía edición
        // de 'allRoles[].isAuthorized' por consola, ahora que las reglas
        // permiten al usuario escribir su propio 'allRoles'.
        // FAIL-OPEN: si la verificación no pudo cargarse (timeout/red), se
        // confía en 'allRoles' para no bloquear roles legítimos.
        const allAuthorized = allRoles.filter(r =>
            r.role === 'superadmin' ||
            (r.isAuthorized && (!_verificationLoaded ||
                _verifiedRoleKeys.has(_roleKey(r.role, r.clubId, r.individualEntityId))))
        );
        const seenRoles = new Set();
        const authorizedRoles = allAuthorized.filter(r => {
            const key = (r.role || '') + '|' + (r.clubId || r.individualEntityId || '');
            if (seenRoles.has(key)) return false;
            seenRoles.add(key);
            return true;
        });

        // Si se eliminaron duplicados, guardar el allRoles limpio en Firestore
        const cleanAllRoles = (() => {
            const seen2 = new Set();
            return allRoles.filter(r => {
                const k = (r.role||'') + '|' + (r.clubId || r.individualEntityId || '');
                if (seen2.has(k)) return false;
                seen2.add(k);
                return true;
            });
        })();
        if (cleanAllRoles.length !== allRoles.length) {
            allRoles = cleanAllRoles;
            fa.setDoc(ref, { allRoles: cleanAllRoles }, { merge: true }).catch(() => {});
        }

        // --- FINAL SYNC TO CURRENT USER OBJECT ---
        window._cronosCurrentUser = {
            uid:         user.uid,
            email:       user.email,
            role:        data.role || (allRoles[0]?.role) || 'user',
            clubId:      data.clubId || (allRoles[0]?.clubId) || null,
            clubName:    data.clubName || (allRoles[0]?.clubName) || null,
            firstName:   data.firstName || null,
            lastName:    data.lastName || null,
            displayName: data.displayName || null,
            isAuthorized: data.isAuthorized || false,
            isIndividual: data.isIndividual || false,
            individualEntityId: data.individualEntityId || null,
            allRoles:     allRoles
        };

        // [Cronos-Privacy] Punto primario: purga PII local del usuario anterior
        // si cambió el uid, ANTES de cualquier cloudGet/syncFromCloud del entrante.
        if (typeof window._purgeStaleLocalDataIfNeeded === 'function') window._purgeStaleLocalDataIfNeeded(user.uid);

        // ── Auto-crear cronos_config/superadmins si es superadmin ──
        // Esto asegura que las reglas de Firestore siempre puedan verificar
        // al superadmin mediante isSuperAdminEmail(), incluso sin custom claims.
        if (data.role === 'superadmin' || data.role === 'admin') {
            _ensureSuperAdminConfig(user.email).catch(e =>
                console.warn('[Cronos] No se pudo crear cronos_config/superadmins:', e.message)
            );
        }

        if (authorizedRoles.length === 0) {
            if(window._CRONOS_DEBUG) console.warn('[Cronos-Auth] No authorized roles for:', user.email);
            await fa.signOut(fa.auth);
            showAuthError('⚠️ Tu cuenta no tiene roles autorizados.');
            return;
        }

        // ── Un solo rol → entrar directamente ───────────────────
        if (authorizedRoles.length === 1) {
            const r = authorizedRoles[0];
            await fa.setDoc(ref, { lastLogin: fa.serverTimestamp() }, { merge: true });

            // SECURITY FIX (SEC-002): Use full reassignment instead of property mutation
            // because _cronosCurrentUser is now wrapped in a protective Proxy
            const _curUser = window._cronosCurrentUser;
            window._cronosCurrentUser = {
                ..._curUser,
                role: r.role,
                clubId: r.clubId || null,
                clubName: r.clubName || null,
            };
            
            enterApp();
            return;
        }

        // ── Múltiples roles → mostrar selector ─────────────────
        enterApp(); // Muestra el landing de "Bienvenido" que invoca showRoleSelection

    } catch (err) {
        console.error('[Cronos] Auth verify error:', err);
        
        // SECURITY FIX (SEC-M08): Removed error recovery that called enterApp().
        // If authorization fails, the user must NOT be let into the app with
        // partial/stale data. Sign out instead so they must re-authenticate.
        if (user) {
            try {
                const fa = window._cronos_auth;
                if (fa) await fa.signOut(fa.auth);
            } catch(signOutErr) {
                console.error('[Cronos] Error signing out after auth failure:', signOutErr);
            }
        }
        
        // Si Firebase no responde o hay error de permisos, dar mensaje útil
        const msg = (err.message || '').includes('Firestore no responde')
            ? '⚠️ Firestore no responde. Comprueba tu conexión a internet e inténtalo de nuevo.'
            : (err.code === 'permission-denied' || (err.message || '').includes('permission'))
            ? '⚠️ Error de permisos. Se está reintentando... Si persiste, contacta al administrador.'
            : 'Error de verificación: ' + (err.message || 'Desconocido');
        showAuthError(msg);
    }
}

// ── Selector Multi-Rol (sin query, usa datos del documento) ──
function _showMultiRolePicker(user, roles) {
    const prev = document.getElementById('multi-role-picker');
    if (prev) prev.remove();

    const overlay = document.createElement('div');
    overlay.id = 'multi-role-picker';
    overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.85);z-index:99999;' +
        'display:flex;align-items:center;justify-content:center;padding:1rem;';

    const roleLabels = {
        superadmin:  '🛡️  Super Administrador',
        club_admin:  '🏛️  Administrador de Club',
        director:    '📋  Director Deportivo',
        coordinator: '🎯  Coordinador',
        user:        '⚽  Entrenador',
        coach:       '⚽  Entrenador',
        parent:      '👨‍👧  Padre / Madre / Tutor',
        individual:  '👤  Administrador Individual',
    };

    const cards = roles.map(r => {
        const label    = roleLabels[r.role] || r.role;
        const clubInfo = r.clubName
            ? '<div style="font-size:0.78rem;color:#7d8590;margin-top:4px;">🏟️ ' +
              (r.clubName || 'Sin club') + '</div>'
            : '';
        const disabled = !r.isAuthorized && r.role !== 'superadmin';
        const badge    = disabled
            ? '<div style="font-size:0.72rem;color:#d29922;margin-top:3px;">⏳ Pendiente de aprobación</div>'
            : '';
        const opacity  = disabled ? 'opacity:0.45;cursor:not-allowed;' : 'cursor:pointer;';

        return '<button class="mrp-btn" data-role="' + r.role + '" data-clubid="' + (r.clubId||'') + '" ' +
            'data-clubname="' + (r.clubName||'') + '" ' +
            'data-fn="' + (r.firstName||'') + '" data-ln="' + (r.lastName||'') + '" ' +
            'data-dn="' + (r.displayName||'') + '" ' +
            'style="width:100%;text-align:left;padding:1rem;margin-bottom:0.6rem;' +
            'background:rgba(255,255,255,0.04);border:1px solid rgba(255,255,255,0.1);' +
            'border-radius:12px;color:white;font-size:0.9rem;transition:all 0.2s;' +
            opacity + '">' +
            '<div style="font-weight:600;">' + label + '</div>' +
            clubInfo + badge + '</button>';
    }).join('');

    overlay.innerHTML =
        '<div style="background:#161b22;border:1px solid rgba(88,166,255,0.3);border-radius:16px;' +
        'padding:1.5rem;width:min(96vw,460px);max-height:85vh;overflow-y:auto;">' +
            '<div style="text-align:center;margin-bottom:1.2rem;">' +
                '<div style="font-weight:700;font-size:1.1rem;color:white;">' +
                    'Selecciona con qué rol deseas entrar</div>' +
                '<div style="font-size:0.8rem;color:#7d8590;margin-top:6px;">' +
                    user.email + '</div>' +
            '</div>' +
            cards +
            '<button id="mrp-close" style="width:100%;padding:0.7rem;margin-top:0.5rem;' +
                'background:rgba(255,70,70,0.1);border:1px solid rgba(255,70,70,0.25);' +
                'border-radius:8px;color:#ff5858;font-size:0.82rem;cursor:pointer;">' +
                'Cerrar sesión</button>' +
        '</div>';
    document.body.appendChild(overlay);

    // Eventos
    overlay.querySelectorAll('.mrp-btn').forEach(btn => {
        btn.addEventListener('mouseenter', () => {
            if (btn.style.cursor === 'not-allowed') return;
            btn.style.background  = 'rgba(88,166,255,0.12)';
            btn.style.borderColor = 'rgba(88,166,255,0.4)';
        });
        btn.addEventListener('mouseleave', () => {
            btn.style.background  = 'rgba(255,255,255,0.04)';
            btn.style.borderColor = 'rgba(255,255,255,0.1)';
        });
        btn.addEventListener('click', () => {
            const role = btn.dataset.role;
            const isAuth = roles.find(r => r.role === role &&
                (r.clubId || null) === (btn.dataset.clubid || null));

            if (!isAuth) return;

            if (!isAuth.isAuthorized && role !== 'superadmin') {
                if (typeof showToast === 'function') {
                    showToast('⏳ Este rol está pendiente de aprobación', 3000);
                }
                return;
            }

            overlay.remove();

            window._cronosCurrentUser = {
                uid:         user.uid,
                email:       user.email,
                role:        role,
                clubId:      btn.dataset.clubid   || null,
                clubName:    btn.dataset.clubname  || null,
                firstName:   btn.dataset.fn        || null,
                lastName:    btn.dataset.ln        || null,
                displayName: btn.dataset.dn        || null,
            };

            // Actualizar lastLogin
            const fa = window._cronos_auth;
            fa.setDoc(
                fa.doc(fa.db, 'users', user.uid),
                { lastLogin: fa.serverTimestamp() },
                { merge: true }
            ).catch(() => {});

            enterApp();
        });
    });

    document.getElementById('mrp-close').addEventListener('click', () => {
        overlay.remove();
        if (window._cronos_auth?.auth) {
            import('https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js')
                .then(({ signOut }) => signOut(window._cronos_auth.auth))
                .then(() => location.reload())
                .catch(() => location.reload());
        } else {
            location.reload();
        }
    });
}

// ── Login / Registro ─────────────────────────────────────────
export async function doAuth() {
    const fa = window._cronos_auth;
    if (!fa) { showAuthError('Firebase no disponible.'); return; }

    // Si hay sesión activa pero el usuario quiere entrar con OTRA cuenta (ha escrito algo), ignorar pending
    const emailInp = document.getElementById('auth-email')?.value.trim();
    const passInp  = document.getElementById('auth-password')?.value;

    if (_isLoginMode && window._pendingAuthUser && !passInp) {
        showAuthError('⏳ Reanudando sesión...');
        const user = window._pendingAuthUser;
        // No consumimos el estado aún por si falla la autorización
        const checkFn = typeof checkAuthorization === 'function' ? checkAuthorization : window._checkAuthorization;
        if (checkFn) {
            return checkFn(user);
        }
    }

    const email    = document.getElementById('auth-email')?.value.trim();
    let password;
    let passwordConfirm;

    if (_isLoginMode) {
        password = document.getElementById('auth-password')?.value;
    } else {
        password = document.getElementById('register-password')?.value;
        passwordConfirm = document.getElementById('register-password-confirm')?.value;
    }

    if (!email || !password) {
        showAuthError('Introduce email y contraseña.'); return;
    }

    showAuthError('⏳ Conectando…');

    try {
        // ═══════════════════════════════════════════════════════
        // LOGIN
        // ═══════════════════════════════════════════════════════
        if (_isLoginMode) {
            window._addingRole = false; // Desbloquear por si acaso
            _addingRoleTimestamp = 0;
            window._loginThisSession = true;
            // Timeout de 6s: si Firebase Auth no responde, mostrar error claro
            const _signInTimer = setTimeout(() => {
                showAuthError('⏳ Conectando… (puede tardar unos segundos)');
            }, 2000);
            const _signInTimeout = new Promise((_, reject) =>
                setTimeout(() => reject(new Error(
                    'La conexión tardó demasiado. Comprueba tu internet e inténtalo de nuevo.'
                )), 6000)
            );
            try {
                await Promise.race([
                    fa.signInWithEmailAndPassword(fa.auth, email, password),
                    _signInTimeout
                ]);
            } finally {
                clearTimeout(_signInTimer);
            }
            return; // onAuthStateChanged → checkAuthorization
        }

        // ═══════════════════════════════════════════════════════
        // REGISTRO
        // ═══════════════════════════════════════════════════════
        const requestedRole   = document.getElementById('auth-role')?.value          || 'user';

        // ── RGPD: el consentimiento es obligatorio para registrarse ──
        const gdprConsent = document.getElementById('gdpr-consent');
        if (!gdprConsent || !gdprConsent.checked) {
            showAuthError('Debes aceptar la Política de Privacidad para registrarte.');
            return;
        }
        // Campos de consentimiento RGPD a persistir en el documento del usuario.
        // Se inyectan en cada ruta de creación de usuario (club, individual, padre, etc.)
        // como evidencia de consentimiento explícito (Art. 7 RGPD).
        const _gdprConsentFields = {
            gdprConsent:        true,
            gdprConsentDate:    fa.serverTimestamp(),
            gdprConsentVersion: '2024-01',
        };

        const _rawClubValue   = document.getElementById('auth-club-select')?.value   || null;
        // Parsear nuevo formato: "club:xxx" o "individual:xxx"
        let selectedClubId    = null;
        let selectedIndivId   = null;
        if (_rawClubValue) {
            if (_rawClubValue.startsWith('club:')) {
                selectedClubId = _rawClubValue.substring(5);
            } else if (_rawClubValue.startsWith('individual:')) {
                selectedIndivId = _rawClubValue.substring(11);
            }
        }
        const newClubName     = document.getElementById('auth-new-club-name')?.value.trim() || '';
        const reqDirectors    = parseInt(document.getElementById('auth-req-directors')?.value)    || 0;
        const reqCoordinators = parseInt(document.getElementById('auth-req-coordinators')?.value) || 0;
        const reqCoaches      = parseInt(document.getElementById('auth-req-coaches')?.value)      || 0;
        const reqParents      = parseInt(document.getElementById('auth-req-parents')?.value)      || 0;
        const firstName       = document.getElementById('auth-firstname')?.value.trim()  || '';
        const lastName        = ''; // eliminado por protección de datos — solo se usa nombre
        const playerName      = document.getElementById('auth-player-name')?.value.trim() || '';  // Nombre del jugador al que representa el padre/tutor
        // Categoría y subcategoría (solo entrenadores y padres)
        const selectedCategory = document.getElementById('auth-category')?.value || '';
        const selectedSubcat   = document.getElementById('auth-subcat')?.value   || '';
        // Tipo de Coordinador (solo rol coordinator): 'f7' | 'f11' | 'f711'
        const _coordType       = document.getElementById('auth-coordinator-type')?.value || '';
        const inviteCode       = document.getElementById('auth-invite-code')?.value.trim().toUpperCase() || '';
        const requestedSlot    = selectedCategory
            ? (selectedSubcat ? `${selectedCategory}_${selectedSubcat}` : selectedCategory)
            : null;

        // ── Validaciones por rol ────────────────────────────────
        if (requestedRole === 'club_admin' && !newClubName && !selectedClubId) {
            showAuthError('⚠️ Indica el nombre de tu club o selecciona uno existente.'); return;
        }
        if (requestedRole === 'individual' && !selectedIndivId) {
            showAuthError('⚠️ Selecciona tu entidad individual del desplegable.'); return;
        }
        // Coordinador: el tipo de coordinación (F7/F11/F7&11) es obligatorio
        if (requestedRole === 'coordinator' && !_coordType) {
            showAuthError('⚠️ Selecciona el tipo de coordinación (Fútbol 7, Fútbol 11 o ambos).'); return;
        }
        // Entrenador/Padre bajo individual: deben seleccionar una entidad individual
        const _entityTypeVal = document.getElementById('auth-entity-type')?.value || '';
        if (['user', 'parent'].includes(requestedRole) && _entityTypeVal === 'individual' && !selectedIndivId) {
            showAuthError('⚠️ Selecciona la entidad individual a la que perteneces.'); return;
        }
        // Entrenador/Padre bajo club: deben seleccionar un club
        if (['user', 'parent'].includes(requestedRole) && _entityTypeVal === 'club' && !selectedClubId) {
            showAuthError('⚠️ Selecciona el club al que perteneces.'); return;
        }
        // Nombre obligatorio para TODOS los roles
        if (!firstName) {
            showAuthError('⚠️ Indica tu nombre.'); return;
        }

        // ── Validaciones de contraseña ──────────────────────────
        if (password !== passwordConfirm) {
            showAuthError('❌ Las contraseñas no coinciden');
            return;
        }

        if (typeof validatePasswordStrength === 'function') {
            const valObj = validatePasswordStrength(password);
            if (!valObj.valid) {
                showAuthError('❌ Contraseña no cumple los requisitos mínimos');
                return;
            }
        }

        // ── Crear cuenta Firebase Auth ──────────────────────────
        window._addingRole = true;
        _addingRoleTimestamp = Date.now();
        let cred;
        let isAddingRole = false;

        try {
            cred = await fa.createUserWithEmailAndPassword(fa.auth, email, password);
        } catch (createErr) {
            if (createErr.code === 'auth/email-already-in-use') {
                try {
                    cred = await fa.signInWithEmailAndPassword(fa.auth, email, password);
                    isAddingRole = true;
                } catch (signInErr) {
                    window._addingRole = false;
                    window._loginThisSession = false;

                    // Distinguir entre errores de contraseña y otros
                    if (signInErr.code === 'auth/wrong-password' || signInErr.code === 'auth/invalid-credential') {
                        showAuthError(
                            '⚠️ Este email ya está registrado, pero la contraseña no coincide. ' +
                            'Para añadir el rol de "' + (requestedRole === 'user' ? 'entrenador' : requestedRole === 'parent' ? 'padre/madre/tutor' : requestedRole === 'director' ? 'director deportivo' : requestedRole === 'coordinator' ? 'coordinador' : requestedRole) +
                            '" a tu cuenta, debes iniciar sesión con la contraseña original y ' +
                            'luego usar la pestaña de Registro para añadir el nuevo rol.'
                        );
                    } else if (signInErr.code === 'auth/user-not-found') {
                        showAuthError(
                            '⚠️ Esta cuenta fue eliminada. ' +
                            'Puedes registrarte de nuevo con el mismo email.'
                        );
                    } else if (signInErr.code === 'auth/too-many-requests') {
                        showAuthError(
                            '⚠️ Demasiados intentos fallidos. ' +
                            'Espera unos minutos e inténtalo de nuevo.'
                        );
                    } else {
                        showAuthError(
                            '⚠️ Este email ya está registrado. ' +
                            'Para añadir un nuevo rol, debes usar la misma contraseña con la que te registraste originalmente.'
                        );
                    }
                    return;
                }
            } else {
                throw createErr;
            }
        }

        // ── Determinar autorización y rol final ─────────────────
        let finalRole    = requestedRole;
        let isAuthorized = false;
        // CRITICAL: When user selects an individual entity, set clubId = selectedIndivId
        // so the user is linked to the entity in the SuperAdmin panel (which queries by clubId)
        let clubId       = selectedClubId || (selectedIndivId ? selectedIndivId : null);
        let clubName     = null;
        // Si seleccionó un administrador individual en el desplegable, interceptar flujo
        let registerUnderIndividual = false;
        let individualOwnerId       = selectedIndivId || null;
        let individualOwnerEmail    = null;

        // FIX: Verificar superadmin con múltiples fuentes para evitar race condition
        // SUPERADMIN_EMAILS puede no estar cargado aún si loadSuperAdminEmails() falló.
        // Verificar también el documento de Firestore y custom claims como fallback.
        const _saEmailsCheck = SUPERADMIN_EMAILS.includes(email);
        let _saClaimCheck = false;
        if (!_saEmailsCheck && cred && cred.user) {
            try {
                const _tokenResult = await cred.user.getIdTokenResult(true); // SECURITY FIX (SEC-M01): Force token refresh
                if (_tokenResult && _tokenResult.claims && _tokenResult.claims.role === 'superadmin') {
                    _saClaimCheck = true;
                }
            } catch(_) {}
        }
        if (_saEmailsCheck || _saClaimCheck) {
            isAuthorized = true;
            finalRole = 'superadmin';
            // SECURITY FIX (SEC-M02): Removed log that exposed superadmin email and claim status
            // 
        }

        // ── Padre/tutor: guardar nombre del jugador que representa ──
        // El campo playerName se almacenará en el documento del usuario.
        // El código de plantilla lo asignará el entrenador más adelante.
        // (Se guarda como playerAlias en el documento Firestore)

        // ── Si seleccionó un administrador individual del desplegable ──
        if (selectedIndivId && !selectedClubId) {
            registerUnderIndividual = true;
            try {
                const m = await import('https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js');
                // Leer la entidad individual: buscar en clubs (type=individual) primero, luego individuals
                let indivSnap = await m.getDoc(m.doc(fa.db, 'clubs', selectedIndivId));
                let _isFromClubs = indivSnap.exists() && indivSnap.data().type === 'individual';
                if (!_isFromClubs) {
                    indivSnap = await m.getDoc(m.doc(fa.db, 'individuals', selectedIndivId));
                }
                if (indivSnap.exists()) {
                    const _indData = indivSnap.data();
                    individualOwnerEmail = _indData.adminEmail || _indData.email || null;

                    // ═══ VERIFICACIÓN ROBUSTECIDA DE hasAdmin ═══
                    // El campo hasAdmin puede estar desactualizado.
                    // Si hasAdmin es false/undefined, verificar también si existen campos de admin
                    // en el documento de la entidad, o en la colección users.
                    let _entityHasAdmin = !!(_indData.hasAdmin || _indData.adminEmail || _indData.adminUid);

                    if (!_entityHasAdmin) {
                        // FALLBACK: Consultar users para verificar si hay admin individual activo
                        try {
                            // Buscar usuarios con clubId = entityId y rol individual activo
                            const usersSnap1 = await m.getDocs(m.query(
                                m.collection(fa.db, 'users'),
                                m.where('clubId', '==', selectedIndivId),
                                m.where('role', 'in', ['individual', 'admin_individual'])
                            ));
                            let _foundAdmin = false;
                            let _adminData = null;
                            usersSnap1.forEach(d => {
                                const u = d.data();
                                if (u.isAuthorized && u.status === 'active' && !u.status.includes('pending')) {
                                    _foundAdmin = true;
                                    _adminData = u;
                                }
                            });

                            // También buscar por individualEntityId
                            if (!_foundAdmin) {
                                const usersSnap2 = await m.getDocs(m.query(
                                    m.collection(fa.db, 'users'),
                                    m.where('individualEntityId', '==', selectedIndivId),
                                    m.where('role', 'in', ['individual', 'admin_individual'])
                                ));
                                usersSnap2.forEach(d => {
                                    const u = d.data();
                                    if (u.isAuthorized && u.status === 'active') {
                                        _foundAdmin = true;
                                        _adminData = u;
                                    }
                                });
                            }

                            if (_foundAdmin) {
                                _entityHasAdmin = true;
                                // CORREGIR la entidad: sincronizar hasAdmin=true
                                try {
                                    const _collection = _isFromClubs ? 'clubs' : 'individuals';
                                    await m.updateDoc(m.doc(fa.db, _collection, selectedIndivId), {
                                        hasAdmin: true,
                                        adminUid: _adminData.uid || _adminData._id || null,
                                        adminEmail: _adminData.email || null,
                                        adminName: _adminData.displayName || _adminData.firstName || null,
                                    });
                                } catch(syncErr) {
                                    console.warn('[Cronos] No se pudo corregir hasAdmin en entidad:', syncErr.message);
                                }
                                // Actualizar email del admin si lo encontramos
                                if (_adminData && !individualOwnerEmail) {
                                    individualOwnerEmail = _adminData.email || null;
                                }
                            }
                        } catch(queryErr) {
                            console.warn('[Cronos] Error consultando users para verificar admin:', queryErr.message);
                            // FIX (admin individual): la query a 'users' falla por reglas de
                            // Firestore cuando el usuario recién creado aún no tiene documento
                            // (un primer admin de una entidad con 0 usuarios). En ese caso NO
                            // podemos verificar si hay admin previo.
                            //   - Si el usuario pide ser 'individual' (Administrador Individual),
                            //     tratarlo como PRIMER admin (_entityHasAdmin = false). El control
                            //     real de duplicados lo hace el SuperAdmin al aprobar la solicitud.
                            //     Si asumiéramos true, se le degradaría a sub-rol 'parent' (bug:
                            //     aparecía como "Padre/Madre/Tutor").
                            //   - Para cualquier OTRO rol (user/parent), mantener el comportamiento
                            //     conservador (_entityHasAdmin = true) para no permitir que un
                            //     entrenador/padre se registre antes de que exista el admin.
                            if (requestedRole === 'individual') {
                                _entityHasAdmin = false;
                            } else {
                                _entityHasAdmin = true;
                            }
                        }
                    }

                    // ═══ LOGÍSTICA INDIVIDUAL ═══
                    // El orden correcto es:
                    // 1. Se crea el ente individual (SA)
                    // 2. Se registra el admin individual → SA aprueba
                    // 3. Se registra el entrenador → admin individual reenvía → SA confirma
                    // 4. Se registran los padres → admin individual reenvía → SA confirma
                    // Si no hay admin, SOLO se puede registrar como admin individual
                    if (!_entityHasAdmin && requestedRole === 'individual') {
                        // Este usuario será el Administrador Individual
                        finalRole = 'individual';
                        registerUnderIndividual = false; // No es sub-usuario
                    } else if (!_entityHasAdmin && requestedRole !== 'individual') {
                        // IMPOSIBLE registrarse como entrenador/padre si no hay admin individual
                        showAuthError('⚠️ No puedes registrarte como ' + (requestedRole === 'user' ? 'Entrenador' : 'Padre/Madre') + ' porque este ente individual aún no tiene Administrador Individual. El Administrador Individual debe registrarse primero.');
                        await fa.signOut(fa.auth).catch(()=>{});
                        return;
                    }
                    // Si ya hay admin → el rol final es el que eligió el usuario (user/parent)
                    // registerUnderIndividual ya es true desde arriba
                }
            } catch(e) {
                console.warn('[Cronos] Error obteniendo datos del individual:', e.message);
            }
        }

        // Obtener nombre del club
        if (clubId) {
            try {
                const m = await import('https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js');
                const clubSnap = await m.getDoc(m.doc(fa.db, 'clubs', clubId));
                if (clubSnap.exists()) {
                    clubName = clubSnap.data().name || null;
                }
            } catch(e) { /* ignorar */ }
        }

        // ── Registrar displayName para individual ───────────────
        let displayName = null;
        if (finalRole === 'individual') {
            const fullName = (firstName + ' ' + lastName).trim();
            displayName = 'Administrador Individual ' + fullName;
        }

        // ── Registro bajo Administrador Individual ─────────────────────────────
        // Interceptar ANTES de isAddingRole para manejar el flujo especial
        // registerUnderIndividual = se seleccionó una entidad individual con admin
        // GUARD (admin individual): un usuario que pide ser 'individual' (Administrador
        // Individual) NUNCA debe entrar al bloque de sub-usuario (entrenador/padre),
        // independientemente de cómo se resolviera _entityHasAdmin. Si llegara aquí con
        // registerUnderIndividual = true por una verificación fallida, se le degradaría
        // a sub-rol 'parent'. Forzamos su exclusión del flujo de sub-usuario.
        const _isUnderIndiv = registerUnderIndividual && requestedRole !== 'individual';
        if (_isUnderIndiv && cred) {
            // El sub-rol es el que el usuario eligió: 'user' (Entrenador) o 'parent' (Padre/Madre/Tutor)
            const _finalSubRole = requestedRole === 'user' ? 'user' : 'parent';
            // Obtener email del individual: del desplegable o del campo manual
            let _ownerEmail = individualOwnerEmail || (document.getElementById('individual-owner-email')?.value || '').trim().toLowerCase();
            let _entityId   = individualOwnerId || null;  // ID de la entidad individual

            // Si tenemos el entity ID pero no el email, buscarlo
            if (_entityId && !_ownerEmail) {
                try {
                    const _m2 = await import('https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js');
                    // Buscar en clubs (type=individual) primero
                    let _entDoc = await _m2.getDoc(_m2.doc(fa.db, 'clubs', _entityId));
                    if (_entDoc.exists() && _entDoc.data().type === 'individual') {
                        _ownerEmail = _entDoc.data().adminEmail || _entDoc.data().email || _ownerEmail;
                    } else {
                        // Fallback a colección 'individuals'
                        _entDoc = await _m2.getDoc(_m2.doc(fa.db, 'individuals', _entityId));
                        if (_entDoc.exists()) _ownerEmail = _entDoc.data().email || _entDoc.data().adminEmail || _ownerEmail;
                    }
                } catch(_) {}
            }

            if (!_ownerEmail && !_entityId) {
                showAuthError('⚠️ Selecciona una entidad individual del desplegable.');
                await fa.signOut(fa.auth).catch(()=>{});
                return;
            }
            try {
                const _m = await import('https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js');

                // Leer la entidad individual para obtener el email del admin
                // NOTA: No bloqueamos si no hay admin — el entrenador puede registrarse
                // y quedará pendiente de que el admin lo apruebe
                if (_entityId) {
                    // Buscar en clubs (type=individual) primero, luego individuals
                    let _entSnap = await _m.getDoc(_m.doc(fa.db, 'clubs', _entityId));
                    let _entFromClubs = _entSnap.exists() && _entSnap.data().type === 'individual';
                    if (!_entFromClubs) {
                        _entSnap = await _m.getDoc(_m.doc(fa.db, 'individuals', _entityId));
                    }
                    if (_entSnap.exists()) {
                        const _entData = _entSnap.data();
                        _ownerEmail = _entData.adminEmail || _entData.email || _ownerEmail;
                        // Si no hay admin aún, el entrenador queda en estado pending_individual
                        // El admin lo aprobará cuando se registre
                        if (!_entData.hasAdmin) {
                            console.warn('[Cronos] Entidad sin admin aún — el entrenador quedará pendiente de aprobación');
                        }
                    }
                }

                const _cat      = document.getElementById('auth-category')?.value || null;
                const _sub      = document.getElementById('auth-subcat')?.value || null;
                const _catLbs   = {prebenjamin:'Prebenjamín',benjamin:'Benjamín',alevin:'Alevín',infantil:'Infantil',cadete:'Cadete',juvenil:'Juvenil',regional:'Regional'};
                const _catLabel = _cat ? (_catLbs[_cat]||_cat)+(_sub?' '+_sub:'') : null;
                const _disp     = (firstName && lastName) ? (firstName+' '+lastName).trim() : (firstName || email);

                // 1. Crear/actualizar documento del sub-usuario
                // Si isAddingRole → añadir rol a allRoles sin sobrescribir existentes
                // CRITICAL: clubId = _entityId so the user is linked to the entity in SuperAdmin
                const _newIndivRole = { role: _finalSubRole, clubId: _entityId, isAuthorized: false, status: 'pending_individual',
                             category: _cat, subcategory: _sub, categoryLabel: _catLabel, playerAlias: playerName || null,
                             individualEntityId: _entityId };

                if (isAddingRole) {
                    // Leer doc existente y añadir el nuevo rol
                    const _existingSnap = await _m.getDoc(_m.doc(fa.db, 'users', cred.user.uid));
                    let _existingRoles = [];
                    if (_existingSnap.exists()) {
                        _existingRoles = _existingSnap.data().allRoles || [];
                    }
                    // Evitar duplicado
                    if (!_existingRoles.some(r => r.role === _finalSubRole && (r.individualEntityId || null) === _entityId)) {
                        _existingRoles.push(_newIndivRole);
                    }
                    await _m.setDoc(_m.doc(fa.db, 'users', cred.user.uid), {
                        individualOwnerId: _entityId, individualOwnerEmail: _ownerEmail,
                        individualEntityId: _entityId,
                        clubId: _entityId,
                        allRoles: _existingRoles,
                    }, { merge: true });
                } else {
                    // Nuevo usuario: crear documento completo
                    // CRITICAL: clubId = _entityId so the user is linked to the entity
                    // in the SuperAdmin panel (which queries by clubId)
                    await _m.setDoc(_m.doc(fa.db, 'users', cred.user.uid), {
                        email, role: _finalSubRole, status: 'pending_individual', isAuthorized: false,
                        individualOwnerId: _entityId, individualOwnerEmail: _ownerEmail,
                        individualEntityId: _entityId,
                        requestedRole: _finalSubRole, firstName: firstName||null, lastName: lastName||null,
                        displayName: _disp, category: _cat, subcategory: _sub, categoryLabel: _catLabel,
                        playerAlias: playerName || null,
                        clubId: _entityId, clubName: null,
                        allRoles: [_newIndivRole],
                        createdAt: new Date().toISOString(),
                        ..._gdprConsentFields,
                    }, { merge: false });
                }

                // 2. Crear platform_request visible en panel Pendientes del individual
                // individualOwnerId = ID de la ENTIDAD (para que el admin pueda buscar por entity)
                const _prId = 'ind_reg_' + _entityId + '_' + cred.user.uid + '_' + Date.now().toString(36);
                await _m.setDoc(_m.doc(fa.db, 'platform_requests', _prId), {
                    type: 'ind_sub_registration', status: 'pending_individual',
                    individualOwnerId: _entityId, individualOwnerEmail: _ownerEmail,
                    userUid: cred.user.uid, userEmail: email, userName: _disp,
                    requestedRole: _finalSubRole,
                    requestedRoleLabel: _finalSubRole === 'user' ? 'Entrenador Individual' : 'Padre/Madre/Tutor Individual',
                    category: _cat, subcategory: _sub, categoryLabel: _catLabel,
                    playerAlias: playerName || null,
                    createdAt: new Date().toISOString(),
                });

                await fa.signOut(fa.auth).catch(()=>{});
                window._addingRole = false; window._loginThisSession = false;
                switchTab('login');
                const _subRoleLabel = _finalSubRole === 'user' ? 'Entrenador' : 'Padre/Madre/Tutor';
                showAuthError('✅ Solicitud de "' + _subRoleLabel + '" enviada. ⏳ Pendiente de aprobación — el Administrador Individual la revisará y la reenviará al SuperAdmin. Una vez aprobada, podrás entrar con ese rol automáticamente.');
            } catch(_err) {
                await fa.signOut(fa.auth).catch(()=>{});
                showAuthError('❌ Error: ' + _err.message);
                console.error('[isUnderIndiv]', _err);
            }
            return;
        }

                if (isAddingRole) {
            // ═══════════════════════════════════════════════════
            // AÑADIR ROL A CUENTA EXISTENTE (sin queries)
            // ═══════════════════════════════════════════════════

            // 1. Leer documento principal (permitido: uid == userId)
            const primarySnap = await fa.getDoc(fa.doc(fa.db, 'users', cred.user.uid));

            if (!primarySnap.exists()) {
                // El email existe en Firebase Auth pero no hay documento en Firestore
                // (fue borrado o nunca se creó). Tratar como REGISTRO NUEVO.
                window._addingRole = false;

                const newAllRoles = [{
                    role:        finalRole,
                    clubId:      clubId,
                    clubName:    clubName,
                    isAuthorized: isAuthorized,
                    firstName:   firstName || null,
                    lastName:    lastName || null,
                    displayName: displayName,
                    category:    selectedCategory || null,
                    subcategory: selectedSubcat   || null,
                }];

                const needsApproval = ['director', 'coordinator', 'user', 'parent'].includes(requestedRole);
                const isUnderIndiv = !!selectedIndivId;
                const userStatus = isAuthorized
                    ? 'active'
                    : (isUnderIndiv && needsApproval ? 'pending_individual'
                    : (needsApproval && clubId ? 'pending_club_admin'
                    : (needsApproval ? 'pending'
                    : (['club_admin','individual'].includes(requestedRole) ? 'pending_sa' : 'pending'))));

                const newUserData = {
                    email,
                    isAuthorized,
                    role:          finalRole,
                    clubId,
                    clubName,
                    playerAlias:   (requestedRole === 'parent') ? (playerName || null) : null,
                    inviteCode:    (requestedRole === 'parent' && inviteCode) ? inviteCode : null,
                    allRoles:      newAllRoles,
                    status:        userStatus,
                    firstName:     firstName || null,
                    createdAt:     fa.serverTimestamp(),
                    lastLogin:     fa.serverTimestamp(),
                    ..._gdprConsentFields,
                };
                if (isUnderIndiv) {
                    newUserData.individualEntityId = selectedIndivId;
                    newUserData.individualOwnerId = selectedIndivId;
                    newUserData.individualOwnerEmail = individualOwnerEmail || null;
                    newAllRoles[0].individualEntityId = selectedIndivId;
                    newAllRoles[0].status = isAuthorized ? 'active' : 'pending_individual';
                }

                await fa.setDoc(fa.doc(fa.db, 'users', cred.user.uid), newUserData);

                // --- VINCULACIÓN INMEDIATA (PADRES) ---
                const targetEntityId = clubId || selectedIndivId;
                if (requestedRole === 'parent' && inviteCode && targetEntityId) {
                    try {
                        const { collection, getDocs, query, where, updateDoc, doc } = await import(
                            'https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js');
                        const linkSnap = await getDocs(query(
                            collection(fa.db, 'cronos_player_links'),
                            where('inviteCode', '==', inviteCode),
                            where('clubId', '==', targetEntityId)
                        ));
                        linkSnap.forEach(async d => {
                            await updateDoc(doc(fa.db, 'cronos_player_links', d.id), {
                                parentUid:   cred.user.uid,
                                parentEmail: email,
                                parentName:  (firstName + ' ' + lastName).trim() || email
                            });
                        });
                    } catch(e) { console.warn('[Auth] Auto-vinculación inmediata fallida:', e.message); }
                }

                // Create platform_request according to context
                if (isUnderIndiv && needsApproval) {
                    // Sub-usuario bajo entidad individual → Administrador Individual
                    const ROLE_LABELS = { user:'Entrenador Individual', parent:'Padre/Madre/Tutor Individual', coordinator:'Coordinador', director:'Director Deportivo' };
                    const reqId = 'ind_reg_' + selectedIndivId + '_' + cred.user.uid + '_' + Date.now().toString(36);
                    await fa.setDoc(fa.doc(fa.db, 'platform_requests', reqId), {
                        type: 'ind_sub_registration',
                        individualOwnerId: selectedIndivId,
                        individualOwnerEmail: individualOwnerEmail || null,
                        inviteCode: (requestedRole === 'parent' && inviteCode) ? inviteCode : null,
                        requestedEmail: email,
                        requestedName: (firstName && lastName) ? (firstName + ' ' + lastName) : '',
                        requestedRole: finalRole,
                        requestedRoleLabel: ROLE_LABELS[finalRole] || finalRole,
                        userUid: cred.user.uid,
                        status: 'pending_individual',
                        createdAt: new Date().toISOString(),
                    });
                } else if (needsApproval && clubId) {
                    const ROLE_LABELS = { user:'Entrenador', parent:'Padre/Madre/Tutor', coordinator:'Coordinador', director:'Director Deportivo' };
                    const reqId = 'self_reg_' + cred.user.uid;
                    await fa.setDoc(fa.doc(fa.db, 'platform_requests', reqId), {
                        type: 'self_registration',
                        clubId: clubId,
                        clubName: clubName || '',
                        inviteCode: (requestedRole === 'parent' && inviteCode) ? inviteCode : null,
                        requestedEmail: email,
                        requestedName: (firstName && lastName) ? (firstName + ' ' + lastName) : '',
                        requestedRole: finalRole,
                        requestedRoleLabel: ROLE_LABELS[finalRole] || finalRole,
                        userUid: cred.user.uid,
                        status: 'pending_club_admin',
                        createdAt: new Date().toISOString(),
                    });
                } else if (['club_admin','individual'].includes(requestedRole) && !isAuthorized) {
                    const saReqId = 'self_reg_' + cred.user.uid + '_' + requestedRole;
                    const _saReqData = {
                        type: 'self_registration',
                        requestedEmail: email,
                        requestedName: (firstName && lastName) ? (firstName + ' ' + lastName) : '',
                        requestedRole: finalRole,
                        requestedRoleLabel: requestedRole === 'club_admin' ? 'Administrador de Club' : 'Administrador Individual',
                        userUid: cred.user.uid,
                        status: 'pending_sa',
                        createdAt: new Date().toISOString(),
                    };
                    // CRITICAL: Include individualOwnerId and clubId for individual role
                    // so the SA approval code can link the admin to the entity
                    if (requestedRole === 'individual' && selectedIndivId) {
                        _saReqData.individualOwnerId = selectedIndivId;
                        _saReqData.clubId = selectedIndivId;
                    }
                    await fa.setDoc(fa.doc(fa.db, 'platform_requests', saReqId), _saReqData);
                }

                // Show result message
                if (!isAuthorized) {
                    await fa.signOut(fa.auth);  // _addingRole sigue true durante signOut
                    window._addingRole = false;
                    window._loginThisSession = false;
                    const rl = { director:'Director Deportivo', coordinator:'Coordinador', user:'Entrenador', parent:'Padre/Madre/Tutor', club_admin:'Administrador de Club', individual:'Administrador Individual' };
                    switchTab('login');
                    if (isUnderIndiv && needsApproval) {
                        showAuthError(
                            '✅ Solicitud de "' + (rl[requestedRole] || requestedRole) +
                            '" enviada. ⏳ Pendiente de aprobación — el Administrador Individual la revisará y la reenviará al SuperAdmin. Una vez aprobada, podrás entrar con ese rol automáticamente.'
                        );
                    } else if (['club_admin','individual'].includes(requestedRole)) {
                        showAuthError(
                            '✅ Solicitud de "' + (rl[requestedRole] || requestedRole) +
                            '" enviada. ⏳ Pendiente de aprobación — el SuperAdmin la revisará directamente.'
                        );
                    } else {
                        showAuthError(
                            '✅ Solicitud de "' + (rl[requestedRole] || requestedRole) +
                            '" enviada. ⏳ Pendiente de confirmación — el administrador del club la revisará y la enviará al SuperAdmin.'
                        );
                    }
                } else {
                    window._addingRole = false;
                    showAuthError('✅ Registro completado. Recargando...');
                    setTimeout(() => location.reload(), 2000);
                }
                return;
            }

            const primaryData = primarySnap.data();

            // ── CHECK: If user was removed, treat as NEW registration ──
            if (primaryData.status === 'removed') {
                // Delete the stale doc completely
                try {
                    const _mdel = await import('https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js');
                    await _mdel.deleteDoc(_mdel.doc(fa.db, 'users', cred.user.uid));
                } catch(_) {}
                // Also delete any platform_requests for this user
                try {
                    const m2 = await import('https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js');
                    const prRef2 = m2.doc(fa.db, 'platform_requests', 'self_reg_' + cred.user.uid);
                    const prSnap2 = await m2.getDoc(prRef2);
                    if (prSnap2.exists()) { await m2.deleteDoc(prRef2); }
                } catch(_) {}
                window._addingRole = false;

                // Create fresh registration (same logic as new user section below)
                const freshAllRoles = [{ role: finalRole, clubId, clubName, isAuthorized: isAuthorized, firstName: firstName || null, lastName: lastName || null, displayName, playerAlias: (requestedRole === 'parent') ? (playerName || null) : null, inviteCode: (requestedRole === 'parent' && inviteCode) ? inviteCode : null, coordinatorType: _coordType || null, category: selectedCategory || null, subcategory: selectedSubcat || null }];
                const freshNeedsApproval = ['director', 'coordinator', 'user', 'parent'].includes(requestedRole);
                const freshIsUnderIndiv = !!selectedIndivId;
                const freshStatus = isAuthorized ? 'active'
                    : (freshIsUnderIndiv && freshNeedsApproval ? 'pending_individual'
                    : (freshNeedsApproval && clubId ? 'pending_club_admin'
                    : (['club_admin','individual'].includes(requestedRole) ? 'pending_sa' : 'pending')));
                const freshData = { email, isAuthorized, role: finalRole, clubId, clubName, playerAlias: (requestedRole === 'parent') ? (playerName || null) : null, inviteCode: (requestedRole === 'parent' && inviteCode) ? inviteCode : null, allRoles: freshAllRoles, status: freshStatus, requestedSlot: null, firstName: firstName || null, createdAt: fa.serverTimestamp(), lastLogin: fa.serverTimestamp(), ..._gdprConsentFields };
                if (requestedRole === 'club_admin') { freshData.requestedClubName = newClubName; freshData.requestedQuotas = { directors: reqDirectors, coordinators: reqCoordinators, coaches: reqCoaches, parents: reqParents }; }
                if (requestedRole === 'individual') { freshData.firstName = firstName; freshData.lastName = lastName; freshData.displayName = displayName; freshData.isIndividual = true; freshData.individualEntityId = selectedIndivId || null; freshData.individualOwnerId = selectedIndivId || null; freshData.individualOwnerEmail = individualOwnerEmail || null; freshAllRoles[0].individualEntityId = selectedIndivId || null; }
                if (freshIsUnderIndiv) { freshData.individualEntityId = selectedIndivId; freshData.individualOwnerId = selectedIndivId; freshData.individualOwnerEmail = individualOwnerEmail || null; freshAllRoles[0].individualEntityId = selectedIndivId; freshAllRoles[0].status = isAuthorized ? 'active' : 'pending_individual'; }
                await fa.setDoc(fa.doc(fa.db, 'users', cred.user.uid), freshData);

                // Create platform_request according to context
                if (freshIsUnderIndiv && freshNeedsApproval) {
                    const RL_IND = { user:'Entrenador Individual', parent:'Padre/Madre/Tutor Individual', coordinator:'Coordinador', director:'Director Deportivo' };
                    await fa.setDoc(fa.doc(fa.db, 'platform_requests', 'ind_reg_' + selectedIndivId + '_' + cred.user.uid + '_' + Date.now().toString(36)), {
                        type: 'ind_sub_registration', individualOwnerId: selectedIndivId, individualOwnerEmail: individualOwnerEmail || null,
                        inviteCode: (requestedRole === 'parent' && inviteCode) ? inviteCode : null,
                        requestedEmail: email, requestedName: (firstName && lastName) ? (firstName + ' ' + lastName) : '',
                        requestedRole: finalRole, requestedRoleLabel: RL_IND[finalRole] || finalRole,
                        userUid: cred.user.uid, status: 'pending_individual', createdAt: new Date().toISOString(),
                    }).catch(function(e) { console.warn('[Cronos] Error creating platform_request:', e); });
                } else if (freshNeedsApproval && clubId) {
                    const RL2 = { user:'Entrenador', parent:'Padre/Madre/Tutor', coordinator:'Coordinador', director:'Director Deportivo' };
                    await fa.setDoc(fa.doc(fa.db, 'platform_requests', 'self_reg_' + cred.user.uid), {
                        type: 'self_registration', clubId, clubName: clubName || '', 
                        inviteCode: (requestedRole === 'parent' && inviteCode) ? inviteCode : null,
                        requestedEmail: email,
                        requestedName: (firstName && lastName) ? (firstName + ' ' + lastName) : '',
                        requestedRole: finalRole, requestedRoleLabel: RL2[finalRole] || finalRole,
                        userUid: cred.user.uid, status: 'pending_club_admin', createdAt: new Date().toISOString(),
                    }).catch(function(e) { console.warn('[Cronos] Error creating platform_request:', e); });
                } else if (['club_admin','individual'].includes(requestedRole) && !isAuthorized) {
                    const _saReqData2 = {
                        type: 'self_registration', requestedEmail: email,
                        requestedName: (firstName && lastName) ? (firstName + ' ' + lastName) : '',
                        requestedRole: finalRole, requestedRoleLabel: requestedRole === 'club_admin' ? 'Administrador de Club' : 'Administrador Individual',
                        userUid: cred.user.uid, status: 'pending_sa', createdAt: new Date().toISOString(),
                    };
                    // CRITICAL: Include individualOwnerId and clubId for individual role
                    if (requestedRole === 'individual' && selectedIndivId) {
                        _saReqData2.individualOwnerId = selectedIndivId;
                        _saReqData2.clubId = selectedIndivId;
                    }
                    await fa.setDoc(fa.doc(fa.db, 'platform_requests', 'self_reg_' + cred.user.uid + '_' + requestedRole), _saReqData2).catch(function(e) { if(window._CRONOS_DEBUG) console.warn('[Cronos] Error creating platform_request:', e); });
                }

                const rl3 = { director:'Director Deportivo', coordinator:'Coordinador', user:'Entrenador', parent:'Padre/Madre/Tutor', club_admin:'Administrador de Club', individual:'Administrador Individual' };
                if (!isAuthorized) {
                    // Mantener _addingRole=true durante signOut para bloquear onAuthStateChanged
                    await fa.signOut(fa.auth);
                    window._addingRole = false;
                    window._loginThisSession = false;
                    switchTab('login');
                    if (freshIsUnderIndiv && freshNeedsApproval) {
                        showAuthError(
                            '✅ Solicitud de "' + (rl3[requestedRole] || requestedRole) + '" enviada.' +
                            ' ⏳ Pendiente de aprobación — el Administrador Individual la revisará y la reenviará al SuperAdmin.'
                        );
                    } else if (['club_admin','individual'].includes(requestedRole)) {
                        showAuthError(
                            '✅ Solicitud de "' + (rl3[requestedRole] || requestedRole) + '" enviada.' +
                            ' ⏳ Pendiente de aprobación — el SuperAdmin la revisará directamente.'
                        );
                    } else {
                        showAuthError(
                            '✅ Solicitud de "' + (rl3[requestedRole] || requestedRole) + '" enviada.' +
                            ' ⏳ Pendiente de aprobación del administrador del club.'
                        );
                    }
                } else {
                    window._addingRole = false;
                    showAuthError('✅ Registro completado. Recargando...');
                    setTimeout(function() { location.reload(); }, 2000);
                }
                return;
            }

            // 2. Verificar duplicado en allRoles (only if NOT removed)
            const currentRoles = primaryData.allRoles || [{
                role:        primaryData.role,
                clubId:      primaryData.clubId      || null,
                clubName:    primaryData.clubName    || null,
                isAuthorized: primaryData.isAuthorized || false,
            }];

            let duplicate = currentRoles.find(r =>
                r.role === requestedRole &&
                (r.clubId || null) === (clubId || null)
            );

            // Si el club del duplicate ya no existe, ignorarlo y limpiar el rol
            if (duplicate && duplicate.clubId) {
                try {
                    const dupClubSnap = await fa.getDoc(fa.doc(fa.db, 'clubs', duplicate.clubId));
                    if (!dupClubSnap.exists()) {
                        const cleanedRoles = currentRoles.filter(r =>
                            !(r.role === requestedRole && r.clubId === duplicate.clubId)
                        );
                        await fa.setDoc(fa.doc(fa.db, 'users', cred.user.uid),
                            { allRoles: cleanedRoles }, { merge: true });
                        duplicate = null;
                    }
                } catch(_) {}
            }

            if (duplicate) {
                // NO limpiar _addingRole aquí — hacerlo después del signOut
                const ROLE_LABELS = {
                    user: 'entrenador', parent: 'padre/madre/tutor',
                    coordinator: 'coordinador', director: 'director deportivo',
                    club_admin: 'administrador de club', individual: 'administrador individual',
                };
                const roleLabel = ROLE_LABELS[requestedRole] || requestedRole;
                const clubInfo = clubId ? ' en este club' : '';

                // Determinar mensaje según si está activo o pendiente
                let duplicateMsg = '';
                if (duplicate.isAuthorized) {
                    duplicateMsg = '✅ Ya tienes el rol de "' + roleLabel + '"' + clubInfo +
                        ' y está activado. Inicia sesión y selecciónalo.';
                } else {
                    // Consultar estado de la platform_request
                    let prStatus = null;
                    try {
                        const m = await import('https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js');
                        // Probar los dos formatos de ID posibles
                        const prIds = [
                            'self_reg_' + cred.user.uid + '_' + requestedRole + '_' + (clubId || ''),
                            'self_reg_' + cred.user.uid + '_' + requestedRole,
                            'self_reg_' + cred.user.uid,
                        ];
                        for (const prId of prIds) {
                            const prSnap = await m.getDoc(m.doc(fa.db, 'platform_requests', prId));
                            if (prSnap.exists()) {
                                const prData = prSnap.data();
                                // Verificar que corresponde al rol que se está solicitando
                                if (!prData.requestedRole || prData.requestedRole === requestedRole) {
                                    prStatus = prData.status;
                                    break;
                                }
                            }
                        }
                    } catch (_) {}

                    let statusMsg = ' ⏳ Pendiente de aprobación. Inicia sesión para comprobar el estado.';
                    // Prioridad: 1. Estado en allRoles (más actualizado), 2. Estado en platform_request
                    const finalStatus = (duplicate && duplicate.status) || prStatus;
                    const isDupUnderIndiv = !!(duplicate.individualEntityId || duplicate.individualOwnerId || selectedIndivId);

                    if (finalStatus === 'pending_individual') {
                        statusMsg = ' ⏳ Pendiente de que el Administrador Individual la revise y la reenvíe al SuperAdmin.';
                    } else if (finalStatus === 'pending_club_admin') {
                        if (isDupUnderIndiv) {
                            statusMsg = ' ⏳ Pendiente de que el Administrador Individual la reenvíe al SuperAdmin.';
                        } else {
                            statusMsg = ' ⏳ Pendiente de que el administrador del club la reenvíe al SuperAdmin.';
                        }
                    } else if (finalStatus === 'pending_sa' || finalStatus === 'pending') {
                        statusMsg = ' ⏳ Reenviada al SuperAdmin. Espera la confirmación final.';
                    } else if (finalStatus === 'sa_approved' || (duplicate && duplicate.isAuthorized)) {
                        statusMsg = ' ✅ Aprobada. Inicia sesión para activarla.';
                    } else if (finalStatus === 'rejected') {
                        if (isDupUnderIndiv) {
                            statusMsg = ' ❌ Rechazada. Contacta con tu Administrador Individual.';
                        } else {
                            statusMsg = ' ❌ Rechazada. Contacta con tu administrador de club.';
                        }
                    }

                    duplicateMsg = 'Ya tienes una solicitud de "' + roleLabel + '"' + clubInfo + ' registrada.' + statusMsg;
                }

                // Sign out y mostrar mensaje
                await fa.signOut(fa.auth).catch(() => {});
                window._addingRole = false;
                window._loginThisSession = false;
                switchTab('login');
                showAuthError(duplicateMsg);
                return;
            }

            // 3. Añadir nuevo rol al array allRoles
            const needsApprovalFlag = ['director', 'coordinator', 'user', 'parent'].includes(requestedRole);
            const isAddingUnderIndiv = !!selectedIndivId && needsApprovalFlag;
            const newRoleEntry = {
                role:        finalRole,
                clubId:      clubId,
                clubName:    clubName,
                isAuthorized: isAuthorized,
                status:      isAuthorized ? 'active' : (isAddingUnderIndiv ? 'pending_individual' : (needsApprovalFlag && clubId ? 'pending_club_admin' : 'pending')),
                firstName:   firstName || null,
                lastName:    lastName || null,
                displayName: displayName,
                playerAlias: (requestedRole === 'parent') ? (playerName || null) : null,
                coordinatorType: _coordType || null,
                category:    selectedCategory || null,
                subcategory: selectedSubcat   || null,
            };
            if (selectedIndivId) {
                newRoleEntry.individualEntityId = selectedIndivId;
            }

            currentRoles.push(newRoleEntry);

            // 4. Actualizar documento principal (always works — user writes own doc)
            const updateData = { allRoles: currentRoles };
            if (requestedRole === 'parent' && playerName) {
                updateData.playerAlias = playerName;
            }
            if (selectedIndivId) {
                updateData.individualEntityId = selectedIndivId;
                updateData.individualOwnerId = selectedIndivId;
                updateData.individualOwnerEmail = individualOwnerEmail || null;
            }
            await fa.setDoc(
                fa.doc(fa.db, 'users', cred.user.uid),
                updateData,
                { merge: true }
            );

            // 5. Crear documento secundario (para queries del club admin)
            // This may fail due to Firestore rules (doc ID != uid), so wrap in try-catch
            const needsApprovalSecondary = ['director', 'coordinator', 'user', 'parent'].includes(requestedRole);
            const secondaryStatus = isAuthorized ? 'active' : (isAddingUnderIndiv ? 'pending_individual' : (needsApprovalSecondary && clubId ? 'pending_club_admin' : 'pending'));
            try {
                const secondaryId = cred.user.uid + '_' + requestedRole + '_' + (clubId || selectedIndivId || 'global');
                const secondaryData = {
                    email,
                    uid:       cred.user.uid,
                    isAuthorized,
                    role:      finalRole,
                    clubId,
                    clubName,
                    status:    secondaryStatus,
                    createdAt: fa.serverTimestamp(),
                    lastLogin: fa.serverTimestamp(),
                };
                if (requestedRole === 'club_admin') {
                    secondaryData.requestedClubName = newClubName;
                    secondaryData.requestedQuotas   = {
                        directors:    reqDirectors,
                        coordinators: reqCoordinators,
                        coaches:      reqCoaches,
                        parents:      reqParents,
                    };
                }
                if (requestedRole === 'individual') {
                    secondaryData.firstName    = firstName;
                    secondaryData.lastName     = lastName;
                    secondaryData.displayName  = displayName;
                    secondaryData.isIndividual = true;
                }
                if (selectedIndivId) {
                    secondaryData.individualEntityId = selectedIndivId;
                    secondaryData.individualOwnerId = selectedIndivId;
                }
                await fa.setDoc(fa.doc(fa.db, 'users', secondaryId), secondaryData);
            } catch (secErr) {
                console.warn('[Cronos] Secondary doc creation failed (permissions). Non-critical — allRoles is the source of truth.', secErr.message);
            }

            // 6. Crear platform_request según el rol
            const needsApproval = ['director', 'coordinator', 'user', 'parent'].includes(requestedRole);
            const needsSAApprovalDirect = ['club_admin', 'individual'].includes(requestedRole);

            if (isAddingUnderIndiv) {
                // Sub-usuario bajo entidad individual → Administrador Individual primero
                try {
                    const ROLE_LABELS = { user:'Entrenador Individual', parent:'Padre/Madre/Tutor Individual', coordinator:'Coordinador', director:'Director Deportivo' };
                    const reqId = 'ind_reg_' + selectedIndivId + '_' + cred.user.uid + '_' + Date.now().toString(36);
                    await fa.setDoc(fa.doc(fa.db, 'platform_requests', reqId), {
                        type: 'ind_sub_registration',
                        individualOwnerId: selectedIndivId,
                        individualOwnerEmail: individualOwnerEmail || null,
                        requestedEmail: email,
                        requestedName: (firstName && lastName) ? (firstName + ' ' + lastName) : '',
                        requestedRole: finalRole,
                        requestedRoleLabel: ROLE_LABELS[finalRole] || finalRole,
                        requestedCategory: selectedCategory || null,
                        requestedSubcategory:   selectedSubcat   || null,
                        userUid: cred.user.uid,
                        status: 'pending_individual',
                        createdAt: new Date().toISOString(),
                    });
                } catch (prErr) {
                    console.warn('[Cronos] Error creando platform_request individual:', prErr.message);
                }

            } else if (needsSAApprovalDirect) {
                // club_admin e individual: platform_request directamente al SA
                // Necesario porque el doc principal tiene status:'active' (ya tiene otros roles)
                // y el SA no lo vería sin este platform_request
                try {
                    const saReqId = 'self_reg_' + cred.user.uid + '_' + requestedRole;
                    const _saReqData3 = {
                        type:              'self_registration',
                        requestedEmail:    email,
                        requestedName:     (firstName && lastName) ? (firstName + ' ' + lastName) : '',
                        requestedRole:     finalRole,
                        requestedRoleLabel: requestedRole === 'club_admin' ? 'Administrador de Club' : 'Administrador Individual',
                        requestedClubName: newClubName || null,
                        requestedQuotas:   requestedRole === 'club_admin' ? {
                            directors: reqDirectors, coordinators: reqCoordinators,
                            coaches: reqCoaches, parents: reqParents,
                        } : null,
                        userUid:    cred.user.uid,
                        status:     'pending_sa',
                        createdAt:  new Date().toISOString(),
                    };
                    // CRITICAL: Include individualOwnerId and clubId for individual role
                    if (requestedRole === 'individual' && selectedIndivId) {
                        _saReqData3.individualOwnerId = selectedIndivId;
                        _saReqData3.clubId = selectedIndivId;
                    }
                    await fa.setDoc(fa.doc(fa.db, 'platform_requests', saReqId), _saReqData3);
                } catch (prErr) {
                    console.warn('[Cronos] Error creando platform_request SA:', prErr.message);
                }

            } else if (needsApproval && clubId) {
                // Entrenador, coordinador, director, padre: al Admin del Club primero
                try {
                    const ROLE_LABELS = { user:'Entrenador', parent:'Padre/Madre/Tutor', coordinator:'Coordinador', director:'Director Deportivo' };
                    const reqId = 'self_reg_' + cred.user.uid + '_' + requestedRole + '_' + (clubId || '');
                    await fa.setDoc(fa.doc(fa.db, 'platform_requests', reqId), {
                        type: 'self_registration',
                        clubId: clubId,
                        clubName: clubName || '',
                        requestedEmail: email,
                        requestedName: (firstName && lastName) ? (firstName + ' ' + lastName) : '',
                        requestedRole: finalRole,
                        requestedRoleLabel: ROLE_LABELS[finalRole] || finalRole,
                        requestedCategory: selectedCategory || null,
                        requestedSubcategory:   selectedSubcat   || null,
                        requestedCoordinatorType: _coordType || null,
                        requestedSlot:     requestedSlot    || null,
                        userUid: cred.user.uid,
                        status: 'pending_club_admin',
                        createdAt: new Date().toISOString(),
                    });
                } catch (prErr) {
                    console.warn('[Cronos] platform_request creation failed:', prErr.message);
                }
            }

            // Mostrar resultado — IMPORTANTE: no limpiar _addingRole antes del signOut
            // para evitar que onAuthStateChanged muestre el selector de roles
            const roleLabel = {
                club_admin: 'Administrador de Club',
                director: 'Director Deportivo',
                coordinator: 'Coordinador',
                user: 'Entrenador',
                parent: 'Padre/Madre/Tutor',
                individual: 'Administrador Individual',
            };

            if (isAuthorized) {
                // Rol directo (superadmin o invitación) — entrar sin esperar
                window._addingRole = false;
                showAuthError(
                    '✅ Rol "' + (roleLabel[requestedRole] || requestedRole) +
                    '" registrado correctamente. Recargando...'
                );
                setTimeout(() => location.reload(), 2000);

            } else if (isAddingUnderIndiv) {
                // Sub-usuario bajo entidad individual → mensaje para Administrador Individual
                await fa.signOut(fa.auth);
                window._addingRole = false;
                window._loginThisSession = false;
                const rl = roleLabel[requestedRole] || requestedRole;
                switchTab('login');
                showAuthError(
                    '✅ Solicitud de "' + rl + '" enviada. ' +
                    '⏳ Pendiente de aprobación — el Administrador Individual la revisará y la reenviará al SuperAdmin. ' +
                    'Una vez aprobada, podrás entrar con ese rol automáticamente.'
                );

            } else if (needsApproval) {
                // ROL PENDIENTE (club): mantener _addingRole=true durante signOut
                // para que onAuthStateChanged no abra el selector de roles
                await fa.signOut(fa.auth);
                window._addingRole = false;
                window._loginThisSession = false;

                // Mostrar mensaje claro de pendiente
                const rl = roleLabel[requestedRole] || requestedRole;
                switchTab('login');
                showAuthError(
                    '✅ Solicitud de "' + rl + '" enviada. ' +
                    '⏳ Pendiente de aprobación — el administrador del club la enviará al SuperAdmin. ' +
                    'Una vez aprobada, podrás entrar con ese rol automáticamente.'
                );

            } else {
                window._addingRole = false;
                showAuthError('✅ Rol solicitado. Pendiente de aprobación. Recargando...');
                setTimeout(() => location.reload(), 2000);
            }

        } else {
            // ═══════════════════════════════════════════════════
            // NUEVO USUARIO (primer registro)
            // ═══════════════════════════════════════════════════

            const allRoles = [{
                role:        finalRole,
                clubId:      clubId,
                clubName:    clubName,
                isAuthorized: isAuthorized,
                firstName:   firstName || null,
                lastName:    lastName || null,
                displayName: displayName,
                category:    selectedCategory || null,
                subcategory: selectedSubcat   || null,
                coordinatorType: _coordType || null,
            }];

            // Determine status: pending_club_admin for roles needing club+SA approval
            const needsClubApproval = ['director', 'coordinator', 'user', 'parent'].includes(requestedRole);
            const _isNewUnderIndiv = !!selectedIndivId && needsClubApproval;
            // ═══ INDIVIDUAL: el administrador individual SIEMPRE necesita aprobación del SA ═══
            // El flujo correcto es: Registro → SA aprueba → Activo
            // NUNCA se auto-autoriza, ni siquiera el primer admin
            let _isIndividualAdmin = false;
            if ((finalRole === 'individual' || finalRole === 'admin_individual') && selectedIndivId) {
                _isIndividualAdmin = true;
            }
            const needsSAApproval   = ['club_admin'].includes(requestedRole) || _isIndividualAdmin;
            // El administrador individual NUNCA se auto-autoriza — siempre necesita SA
            const userStatus = isAuthorized
                ? 'active'
                : _isNewUnderIndiv ? 'pending_individual'
                : needsClubApproval ? 'pending_club_admin'
                : needsSAApproval   ? 'pending_sa'
                : 'pending';

            const userData = {
                email,
                isAuthorized,
                role:          finalRole,
                clubId,
                clubName,
                allRoles,
                status:        userStatus,
                requestedSlot: null,
                createdAt:     fa.serverTimestamp(),
                lastLogin:     fa.serverTimestamp(),
                ..._gdprConsentFields,
            };

            let _isFirstIndividualAdmin = false;
            if (requestedRole === 'club_admin' || (finalRole === 'individual' && !_isFirstIndividualAdmin)) {
                userData.requestedClubName = newClubName || clubName || '';
                userData.requestedQuotas   = {
                    directors:    reqDirectors,
                    coordinators: reqCoordinators,
                    coaches:      reqCoaches,
                    parents:      reqParents,
                };
            }

            if (finalRole === 'individual' || finalRole === 'admin_individual') {
                userData.role = 'individual'; // Normalizar a 'individual' para evitar estados divididos
                userData.firstName    = firstName;
                userData.lastName     = lastName;
                userData.displayName  = displayName;
                userData.isIndividual = true;
                userData.individualEntityId = selectedIndivId || null;
                userData.individualOwnerId  = selectedIndivId || null;
                userData.individualOwnerEmail = individualOwnerEmail || null;
                // CRITICAL: also set individualEntityId in allRoles so saIndividuals() can map
                allRoles[0].role = 'individual';
                allRoles[0].individualEntityId = selectedIndivId || null;
                // El admin individual SIEMPRE empieza como pending_sa — el SA debe aprobar
                allRoles[0].isAuthorized = false;
                allRoles[0].status = 'pending_sa';
                userData.isAuthorized = false;
                userData.status = 'pending_sa';
            }

            // Sub-usuario bajo entidad individual: añadir campos individuales y actualizar allRoles
            if (_isNewUnderIndiv) {
                userData.individualEntityId   = selectedIndivId;
                userData.individualOwnerId    = selectedIndivId;
                userData.individualOwnerEmail = individualOwnerEmail || null;
                allRoles[0].individualEntityId = selectedIndivId;
                allRoles[0].status = 'pending_individual';
            }

            await fa.setDoc(fa.doc(fa.db, 'users', cred.user.uid), userData);

            // --- VINCULACIÓN INMEDIATA (PADRES - AÑADIR ROL) ---
            const targetEntityId = clubId || selectedIndivId;
            if (requestedRole === 'parent' && inviteCode && targetEntityId) {
                try {
                    const { collection, getDocs, query, where, updateDoc, doc } = await import(
                        'https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js');
                    const linkSnap = await getDocs(query(
                        collection(fa.db, 'cronos_player_links'),
                        where('inviteCode', '==', inviteCode),
                        where('clubId', '==', targetEntityId)
                    ));
                    linkSnap.forEach(async d => {
                        await updateDoc(doc(fa.db, 'cronos_player_links', d.id), {
                            parentUid:   cred.user.uid,
                            parentEmail: email,
                            parentName:  (firstName + ' ' + lastName).trim() || email
                        });
                    });
                } catch(e) { console.warn('[Auth] Auto-vinculación inmediata (add role) fallida:', e.message); }
            }

            // Si es admin individual, crear platform_request para que el SA apruebe
            // y para que checkAuthorization() pueda auto-activar al usuario
            // NUNCA se actualiza hasAdmin hasta que el SA apruebe
            // NOTA: Esta platform_request NO aparecerá duplicada en saRequests()
            // porque filtramos self_registration+club_admin/individual de la sección de reenviados
            if (_isIndividualAdmin && selectedIndivId) {
                try {
                    const _m4 = await import('https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js');
                    const _prId = 'ind_admin_' + selectedIndivId + '_' + cred.user.uid + '_' + Date.now().toString(36);
                    await _m4.setDoc(_m4.doc(fa.db, 'platform_requests', _prId), {
                        type: 'ind_admin_registration',
                        status: 'pending_sa',
                        individualOwnerId: selectedIndivId,
                        individualOwnerEmail: individualOwnerEmail || null,
                        requestedEmail: email,
                        requestedName: (firstName && lastName) ? (firstName + ' ' + lastName) : (firstName || email),
                        requestedRole: 'individual',
                        requestedRoleLabel: 'Administrador Individual',
                        userUid: cred.user.uid,
                        createdAt: new Date().toISOString(),
                    });
                } catch(_e) { console.warn('[Cronos] Error creando platform_request para admin individual:', _e.message); }
            }

            // Crear platform_request según el rol
            // club_admin e individual: el user doc ya tiene status:'pending_sa'
            // El SA los verá directamente en la lista de "Registros pendientes"
            // No hace falta platform_request para evitar duplicados en el panel SA
            const _newUserUnderIndiv = _isNewUnderIndiv;
            if (_newUserUnderIndiv) {
                // Sub-usuario bajo entidad individual → Administrador Individual primero
                const reqId = 'ind_reg_' + selectedIndivId + '_' + cred.user.uid + '_' + Date.now().toString(36);
                const RLABELS_IND = { user:'Entrenador Individual', parent:'Padre/Madre/Tutor Individual', coordinator:'Coordinador', director:'Director Deportivo' };
                await fa.setDoc(fa.doc(fa.db, 'platform_requests', reqId), {
                    type:              'ind_sub_registration',
                    individualOwnerId: selectedIndivId,
                    individualOwnerEmail: individualOwnerEmail || null,
                    requestedEmail:    email,
                    requestedName:     (firstName && lastName) ? (firstName + ' ' + lastName) : '',
                    requestedRole:     finalRole,
                    requestedRoleLabel: RLABELS_IND[finalRole] || finalRole,
                    requestedCategory: selectedCategory || null,
                    requestedSubcategory:   selectedSubcat   || null,
                    userUid:           cred.user.uid,
                    status:            'pending_individual',
                    createdAt:         new Date().toISOString(),
                });
            } else if (needsClubApproval && clubId) {
                // Entrenador, coordinador, director, padre → Admin Club primero
                const reqId = 'self_reg_' + cred.user.uid;
                const RLABELS = { user:'Entrenador', parent:'Padre/Madre/Tutor', coordinator:'Coordinador', director:'Director Deportivo' };
                await fa.setDoc(fa.doc(fa.db, 'platform_requests', reqId), {
                    type:              'self_registration',
                    clubId:            clubId,
                    clubName:          clubName || '',
                    requestedEmail:    email,
                    requestedName:     (firstName && lastName) ? (firstName + ' ' + lastName) : '',
                    requestedRole:     finalRole,
                    requestedRoleLabel: RLABELS[finalRole] || finalRole,
                    requestedCategory: selectedCategory || null,
                    requestedSubcategory:   selectedSubcat   || null,
                    requestedSlot:     requestedSlot    || null,
                    userUid:           cred.user.uid,
                    status:            'pending_club_admin',
                    createdAt:         new Date().toISOString(),
                });
            }

            // Post-registro
            if (!isAuthorized) {
                // _addingRole sigue true → bloquea el observer durante signOut
                await fa.signOut(fa.auth);
                window._addingRole = false;
                window._loginThisSession = false;

                const msgByRole = {
                    club_admin: '✅ Solicitud de club enviada al SuperAdmin. Recibirás confirmación por correo.',
                    individual: '✅ Solicitud enviada al SuperAdmin. Pendiente de aprobación.',
                };
                const rl = { director:'Director Deportivo', coordinator:'Coordinador',
                              user:'Entrenador', parent:'Padre/Madre/Tutor' };
                switchTab('login');
                if (_newUserUnderIndiv) {
                    showAuthError(
                        '✅ Solicitud de "' + (rl[requestedRole] || rl[finalRole] || requestedRole) + '" enviada correctamente. ' +
                        '⏳ Pendiente de aprobación — el Administrador Individual la revisará y la reenviará al SuperAdmin. ' +
                        'Cuando sea aprobada podrás entrar con ese rol automáticamente.'
                    );
                } else {
                    showAuthError(
                        msgByRole[requestedRole] || msgByRole[finalRole] ||
                        '✅ Solicitud de "' + (rl[requestedRole] || rl[finalRole] || requestedRole) + '" enviada correctamente. ' +
                        '⏳ Pendiente de confirmación — el administrador del club la revisará y la enviará al SuperAdmin. ' +
                        'Cuando sea aprobada podrás entrar con ese rol automáticamente.'
                    );
                }
            } else {
                window._addingRole = false;
                if (_isIndividualAdmin) {
                    // Admin individual siempre necesita aprobación del SA
                    await fa.signOut(fa.auth);
                    window._addingRole = false;
                    window._loginThisSession = false;
                    switchTab('login');
                    showAuthError('✅ Solicitud de Administrador Individual enviada. ⏳ Pendiente de aprobación por el SuperAdmin. Una vez aprobada, podrás entrar con ese rol automáticamente.');
                } else {
                    showAuthError('✅ Registro completado. Entrando…');
                }
            }
        }

    } catch(e) {
        window._addingRole = false;
        const msgs = {
            'auth/invalid-email':        'Email no válido.',
            'auth/user-not-found':        'Usuario no encontrado.',
            'auth/wrong-password':        'Contraseña incorrecta.',
            'auth/invalid-credential':    'Email o contraseña incorrectos.',
            'auth/weak-password':         'Contraseña demasiado corta (mínimo 6 caracteres).',
        };
        showAuthError(msgs[e.code] || ('Error: ' + e.message));
        window._loginThisSession = false;
    }
}

// ── Entrar en la app ──────────────────────────────────────────
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

// ── Logout ─────────────────────────────────────────────────
window.logoutUser = () => {
    if (!confirm('¿Seguro que deseas salir y volver al inicio?')) return;
    sessionStorage.clear();
    // [Cronos-Privacy] Logout: purga incondicional de PII + marcador.
    if (typeof window._cronosPurgeAllLocalPII === 'function') window._cronosPurgeAllLocalPII();
    if (window._cronos_auth?.auth) {
        import('https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js')
            .then(({ signOut }) => {
                signOut(window._cronos_auth.auth).finally(() => location.reload());
            })
            .catch(() => location.reload());
    } else {
        location.reload();
    }
};

// ── Exportación Global ───────────────────────────────────────
window.switchTab            = switchTab;
window.handleRoleChange     = handleRoleChange;
window.handleEntityChange   = handleEntityChange;
window.doAuth               = doAuth;
window.selectOption         = selectOption;
window._checkAuthorization  = checkAuthorization;
window.enterApp             = enterApp;
window.showRoleSelector     = showRoleSelection;
window.showAuthError        = showAuthError;
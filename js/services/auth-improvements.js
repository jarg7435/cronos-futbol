/**
 * Chronos Fútbol - Auth Improvements v8.0
 * Mejoras en registro: ojo de contraseña, validación y re-registro
 * 
 * INSTRUCCIONES: Integrar estas funciones en tu auth.js actual
 */

// ═══════════════════════════════════════════════════════════════════════════
// MEJORA 1: Ojo para mostrar/ocultar contraseña en el HTML
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Reemplaza los campos de contraseña en index.html con esta estructura:
 * 
 * <div style="position:relative;display:flex;align-items:center;">
 *     <input type="password" id="register-password" 
 *            placeholder="Contraseña (mín. 8 caracteres)"
 *            style="flex:1;padding-right:2.5rem;">
 *     <button type="button" id="toggle-pwd-register" 
 *             style="position:absolute;right:0.5rem;background:none;border:none;
 *                    cursor:pointer;font-size:1.2rem;padding:0.3rem 0.5rem;">👁️</button>
 * </div>
 * 
 * <div style="position:relative;display:flex;align-items:center;">
 *     <input type="password" id="register-password-confirm" 
 *            placeholder="Confirmar contraseña"
 *            style="flex:1;padding-right:2.5rem;">
 *     <button type="button" id="toggle-pwd-confirm" 
 *             style="position:absolute;right:0.5rem;background:none;border:none;
 *                    cursor:pointer;font-size:1.2rem;padding:0.3rem 0.5rem;">👁️</button>
 * </div>
 */

// Inicializar toggles de contraseña
function initPasswordToggles() {
    const toggles = [
        { inputId: 'register-password', btnId: 'toggle-pwd-register' },
        { inputId: 'register-password-confirm', btnId: 'toggle-pwd-confirm' },
        { inputId: 'login-password', btnId: 'toggle-pwd-login' },
    ];

    toggles.forEach(({ inputId, btnId }) => {
        const input = document.getElementById(inputId);
        const btn = document.getElementById(btnId);

        if (input && btn) {
            btn.addEventListener('click', (e) => {
                e.preventDefault();
                const isPassword = input.type === 'password';
                input.type = isPassword ? 'text' : 'password';
                btn.textContent = isPassword ? '🙈' : '👁️';
                btn.title = isPassword ? 'Ocultar contraseña' : 'Mostrar contraseña';
            });
        }
    });
}

// Llamar después de que el DOM esté listo
// NOTA: los toggles del ojo de contraseña los gestiona wireToggle() en
// index.html (IDs correctos: auth-password / register-password /
// register-password-confirm). NO conectamos aquí initPasswordToggles()
// para evitar un doble listener que alternaba el tipo dos veces por clic
// (el icono parecia no funcionar). Se conserva la funcion por compatibilidad.
// document.addEventListener('DOMContentLoaded', initPasswordToggles);

// ═══════════════════════════════════════════════════════════════════════════
// MEJORA 2: Validación de Contraseña en Tiempo Real
// ═══════════════════════════════════════════════════════════════════════════

function validatePasswordStrength(password) {
    const requirements = {
        length: password.length >= 8,
        uppercase: /[A-Z]/.test(password),
        lowercase: /[a-z]/.test(password),
        number: /[0-9]/.test(password),
        special: /[!@#$%^&*]/.test(password),
    };

    const score = Object.values(requirements).filter(Boolean).length;
    
    return {
        valid: score === 5,
        score,
        requirements,
        strength: score <= 2 ? 'Débil' : score <= 3 ? 'Media' : score <= 4 ? 'Fuerte' : 'Muy Fuerte',
    };
}

function setupPasswordValidator(inputId, feedbackId) {
    const input = document.getElementById(inputId);
    const feedback = document.getElementById(feedbackId);

    if (!input || !feedback) return;

    input.addEventListener('input', () => {
        const validation = validatePasswordStrength(input.value);
        
        if (input.value.length === 0) {
            feedback.innerHTML = '';
            return;
        }

        const colors = {
            'Débil': '#ff5858',
            'Media': '#f0883e',
            'Fuerte': '#58a6ff',
            'Muy Fuerte': '#3fb950',
        };

        const color = colors[validation.strength];
        const checklist = `
            <div style="font-size:0.75rem;color:var(--text-muted);margin-top:0.3rem;">
                <div style="color:${validation.requirements.length ? '#3fb950' : '#ff5858'};">
                    ${validation.requirements.length ? '✅' : '❌'} Mínimo 8 caracteres
                </div>
                <div style="color:${validation.requirements.uppercase ? '#3fb950' : '#ff5858'};">
                    ${validation.requirements.uppercase ? '✅' : '❌'} Una mayúscula
                </div>
                <div style="color:${validation.requirements.lowercase ? '#3fb950' : '#ff5858'};">
                    ${validation.requirements.lowercase ? '✅' : '❌'} Una minúscula
                </div>
                <div style="color:${validation.requirements.number ? '#3fb950' : '#ff5858'};">
                    ${validation.requirements.number ? '✅' : '❌'} Un número
                </div>
                <div style="color:${validation.requirements.special ? '#3fb950' : '#ff5858'};">
                    ${validation.requirements.special ? '✅' : '❌'} Un carácter especial (!@#$%^&*)
                </div>
                <div style="margin-top:0.3rem;font-weight:700;color:${color};">
                    Fortaleza: ${validation.strength}
                </div>
            </div>
        `;

        feedback.innerHTML = checklist;
    });
}

// Llamar después de que el DOM esté listo
document.addEventListener('DOMContentLoaded', () => {
    setupPasswordValidator('register-password', 'password-feedback');
});

// ═══════════════════════════════════════════════════════════════════════════
// MEJORA 3: Verificación de Coincidencia de Contraseñas
// ═══════════════════════════════════════════════════════════════════════════

function setupPasswordMatch(pwd1Id, pwd2Id, matchFeedbackId) {
    const pwd1 = document.getElementById(pwd1Id);
    const pwd2 = document.getElementById(pwd2Id);
    const feedback = document.getElementById(matchFeedbackId);

    if (!pwd1 || !pwd2 || !feedback) return;

    const checkMatch = () => {
        if (pwd2.value.length === 0) {
            feedback.innerHTML = '';
            return;
        }

        const match = pwd1.value === pwd2.value;
        feedback.innerHTML = `
            <div style="font-size:0.75rem;margin-top:0.2rem;color:${match ? '#3fb950' : '#ff5858'};font-weight:700;">
                ${match ? '✅ Las contraseñas coinciden' : '❌ Las contraseñas no coinciden'}
            </div>
        `;
    };

    pwd1.addEventListener('input', checkMatch);
    pwd2.addEventListener('input', checkMatch);
}

document.addEventListener('DOMContentLoaded', () => {
    setupPasswordMatch('register-password', 'register-password-confirm', 'password-match-feedback');
});

// ═══════════════════════════════════════════════════════════════════════════
// MEJORA 4: Permitir Re-registro de Usuarios Eliminados
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Integrar en la función de registro (en auth.js):
 * 
 * async function handleRegister(email, password, passwordConfirm) {
 *     try {
 *         // 1. Validar que las contraseñas coincidan
 *         if (password !== passwordConfirm) {
 *             showToast('❌ Las contraseñas no coinciden', 3000);
 *             return;
 *         }
 *
 *         // 2. Validar fortaleza de contraseña
 *         const validation = validatePasswordStrength(password);
 *         if (!validation.valid) {
 *             showToast('❌ Contraseña no cumple los requisitos mínimos', 4000);
 *             return;
 *         }
 *
 *         showSpinner('Registrando usuario...');
 *
 *         const { fa, collection, query, where, getDocs, deleteDoc, doc } = await saFS();
 *
 *         // 3. Buscar si el usuario fue eliminado anteriormente
 *         const q = query(
 *             collection(fa.db, 'users'),
 *             where('email', '==', email),
 *             where('status', 'in', ['removed', 'blocked'])
 *         );
 *         const snapshot = await getDocs(q);
 *
 *         if (snapshot.size > 0) {
 *             // Usuario fue eliminado, limpiar el documento antiguo
 *             const oldDoc = snapshot.docs[0];
 *             await deleteDoc(doc(fa.db, 'users', oldDoc.id));
 *             
 *         }
 *
 *         // 4. Crear usuario en Firebase Auth
 *         const userCred = await createUserWithEmailAndPassword(auth, email, password);
 *         const uid = userCred.user.uid;
 *
 *         // 5. Crear documento en Firestore con estado "pending"
 *         await setDoc(doc(fa.db, 'users', uid), {
 *             email,
 *             uid,
 *             isAuthorized: false,
 *             status: 'pending',  // Esperando visto bueno del admin
 *             role: 'user',
 *             createdAt: new Date().toISOString(),
 *             requestedSlot: null,  // Se asignará cuando el admin apruebe
 *         });
 *
 *         hideSpinner();
 *         showToast('✅ Registro exitoso. Pendiente de autorización del administrador.', 4000);
 *         switchTab('login');
 *
 *     } catch (e) {
 *         hideSpinner();
 *         if (e.code === 'auth/email-already-in-use') {
 *             showToast('❌ Este email ya está registrado y activo', 3000);
 *         } else {
 *             showToast(`⚠️ Error: ${e.message}`, 4000);
 *         }
 *         console.error('Error en registro:', e);
 *     }
 * }
 */

// ═══════════════════════════════════════════════════════════════════════════
// MEJORA 5: Nuevo Estado "pending" en Registro
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Estados de usuario mejorados:
 * 
 * - "pending": Usuario se registró, esperando visto bueno del admin
 * - "active": Usuario autorizado y activo
 * - "blocked": Usuario bloqueado por el admin
 * - "removed": Usuario eliminado (puede re-registrarse)
 * 
 * Flujo:
 * 1. Usuario se registra → status: "pending"
 * 2. Admin solicita plaza al SuperAdmin → slot_requests
 * 3. SuperAdmin aprueba plaza → slots disponibles en club
 * 4. Admin da visto bueno → status: "active"
 * 5. Usuario puede entrar a la app
 */

// ═══════════════════════════════════════════════════════════════════════════
// MEJORA 6: HTML Mejorado para Registro
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Reemplaza la sección de registro en index.html con esto:
 * 
 * <div id="register-tab" style="display:none;">
 *     <div style="margin-bottom:1rem;">
 *         <label class="sa-label">Email</label>
 *         <input type="email" id="register-email" placeholder="tu@email.com"
 *                style="width:100%;padding:0.6rem;border:1px solid var(--glass-border);
 *                       border-radius:8px;background:rgba(255,255,255,0.06);color:var(--text);">
 *     </div>
 *
 *     <div style="margin-bottom:1rem;">
 *         <label class="sa-label">Contraseña</label>
 *         <div style="position:relative;display:flex;align-items:center;">
 *             <input type="password" id="register-password" 
 *                    placeholder="Mínimo 8 caracteres"
 *                    style="flex:1;padding:0.6rem;padding-right:2.5rem;
 *                           border:1px solid var(--glass-border);border-radius:8px;
 *                           background:rgba(255,255,255,0.06);color:var(--text);">
 *             <button type="button" id="toggle-pwd-register" 
 *                     style="position:absolute;right:0.5rem;background:none;border:none;
 *                            cursor:pointer;font-size:1.2rem;padding:0.3rem 0.5rem;
 *                            color:var(--text-muted);">👁️</button>
 *         </div>
 *         <div id="password-feedback"></div>
 *     </div>
 *
 *     <div style="margin-bottom:1rem;">
 *         <label class="sa-label">Confirmar Contraseña</label>
 *         <div style="position:relative;display:flex;align-items:center;">
 *             <input type="password" id="register-password-confirm" 
 *                    placeholder="Repite tu contraseña"
 *                    style="flex:1;padding:0.6rem;padding-right:2.5rem;
 *                           border:1px solid var(--glass-border);border-radius:8px;
 *                           background:rgba(255,255,255,0.06);color:var(--text);">
 *             <button type="button" id="toggle-pwd-confirm" 
 *                     style="position:absolute;right:0.5rem;background:none;border:none;
 *                            cursor:pointer;font-size:1.2rem;padding:0.3rem 0.5rem;
 *                            color:var(--text-muted);">👁️</button>
 *         </div>
 *         <div id="password-match-feedback"></div>
 *     </div>
 *
 *     <button onclick="handleRegister()"
 *             style="width:100%;padding:0.7rem;background:var(--primary);color:#000;
 *                    border:none;border-radius:8px;font-weight:700;cursor:pointer;
 *                    margin-bottom:0.5rem;">
 *         REGISTRARSE
 *     </button>
 * </div>
 */


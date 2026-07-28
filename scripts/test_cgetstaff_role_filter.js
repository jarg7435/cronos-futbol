// ─────────────────────────────────────────────────────────────────────────
// test_cgetstaff_role_filter.js  ·  6ª ronda tras pruebas del usuario:
// "los mensajes que envía el entrenador al director deportivo y al
// coordinador se cruzan y se mezclan, apareciendo idénticos y compartidos
// en los paneles de ambos receptores"
//
// El usuario verificó con un diagnóstico en consola que su navegador
// ejecutaba el código correcto (SW v349, _resetChatThreadPane presente) —
// descartado el problema de caché. La causa real estaba en _cGetStaff
// (js/coach/comms/panel.js): la "REGLA 1" (director/coordinador reciben
// SIEMPRE el informe colectivo) filtraba por
//   c.role === 'director' || c.role === 'coordinator'
// SIN comprobar `roles.includes(c.role)` — el parámetro que indica qué
// rol(es) se pidieron realmente. _cGetStaff se llama con roles=[selectedRole]
// desde las pestañas de mensajería 1:1 (p.ej. solo ['director']). Una cuenta
// con VARIOS roles a la vez (director Y coordinador, mismo uid — caso real
// del usuario) tiene UNA sola ficha en Gestión de Contactos con un ÚNICO
// `role` guardado (p.ej. 'coordinator'); REGLA 1 la colaba en la pestaña
// "Director" igualmente, etiquetada como 'coordinator', y el mensaje se
// enviaba al hilo del rol equivocado.
//
// Fix: añadido `&& roles.includes(c.role)` a REGLA 1, igual que ya tienen
// las otras 2 fuentes de _cGetStaff.
// ─────────────────────────────────────────────────────────────────────────
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.join(__dirname, '..');
let fail = 0, pass = 0;
const ok = (name, cond, extra) => {
    if (cond) { pass++; console.log('PASS ' + name); }
    else { fail++; console.log('FAIL ' + name); if (extra !== undefined) console.log('       ' + extra); }
};

console.log('── _cGetStaff: REGLA 1 respeta el rol solicitado por pestaña ──\n');

const src = fs.readFileSync(path.join(ROOT, 'js', 'coach', 'comms', 'panel.js'), 'utf8');

// ═══════════════════ PARTE 1 · estructura ══════════════════
console.log('── PARTE 1 · estructura ──');
const fnStart = src.indexOf('async function _cGetStaff');
const fnEnd = src.indexOf('\nasync function ', fnStart + 10);
const fnBody = src.slice(fnStart, fnEnd);

ok('1a · [FIX] REGLA 1 exige roles.includes(c.role)',
   /\(c\.role === 'director' \|\| c\.role === 'coordinator'\) &&\s*\n\s*roles\.includes\(c\.role\)/.test(fnBody));

// ═══════════════════ PARTE 2 · ejecución REAL en sandbox ═══════════════════
console.log('\n── PARTE 2 · ejecución del código real (escenario exacto del usuario) ──');

async function run() {
    // Una cuenta con VARIOS roles (director Y coordinador, MISMO uid), con
    // una única ficha en Gestión de Contactos (emailConfig.contacts) cuyo
    // campo `role` guarda solo UNO de ellos (aquí: 'coordinator') — así es
    // como openContactManager la construye (una fila por documento
    // users/{uid}, no una por rol).
    const MULTI_ROLE_UID = 'multi-role-uid';
    const sandbox = {
        window: {},
        emailConfig: {
            contacts: [
                { uid: MULTI_ROLE_UID, role: 'coordinator', type: 'staff', tags: ['cv','tr','msg','rpt'], name: 'Yo Mismo', email: 'yo@club.com' },
            ],
        },
        console: { log(){}, warn(){}, error(){} },
        cloudGet: async () => null,
        __imp: async () => ({
            collection: (_db, name) => ({ __col: name }),
            getDocs: async (q) => {
                if (q.__col === 'users' && q.__whereRole) {
                    // Paso 2: query mono-rol — este usuario NO tiene ese
                    // valor como campo raíz `role` (su raíz dice, p.ej.,
                    // 'director', da igual): no lo devuelve. Step 3 es quien
                    // debe encontrarlo vía allRoles.
                    return { forEach: () => {} };
                }
                if (q.__col === 'users') {
                    // Paso 3: TODOS los usuarios del club, con allRoles
                    // conteniendo AMBOS roles reales para esta cuenta.
                    const docs = [{
                        id: MULTI_ROLE_UID,
                        data: () => ({
                            clubId: 'clubX',
                            allRoles: [
                                { role: 'director', isAuthorized: true, status: 'active' },
                                { role: 'coordinator', isAuthorized: true, status: 'active' },
                            ],
                        }),
                    }];
                    return { forEach: (cb) => docs.forEach(cb) };
                }
                return { forEach: () => {} };
            },
            query: (col, ...clauses) => ({ __col: col.__col, __whereRole: clauses.some(c => c && c.__isRoleClause) }),
            where: (field, op, val) => (field === 'role' ? { __isRoleClause: true, field, op, val } : { field, op, val }),
            doc: () => ({}),
            getDoc: async () => ({ exists: () => false }),
        }),
    };
    vm.createContext(sandbox);
    const patched = fnBody.replace(/\bimport\s*\(/g, '__imp(');
    vm.runInContext(patched + '\nthis._cGetStaff = _cGetStaff;', sandbox, { filename: '_cGetStaff.js' });

    const fns = await sandbox.__imp();

    // 2a. Pestaña "Director" (roles=['director']) -> SOLO debe aparecer
    //     etiquetado como 'director', NUNCA como 'coordinator'.
    const directorTabList = await sandbox._cGetStaff({}, 'clubX', fns, ['director']);
    const wrongTagInDirectorTab = directorTabList.filter(s => s.uid === MULTI_ROLE_UID && s.role !== 'director');
    ok('2a · [HUECO CERRADO] pestaña Director: la cuenta multi-rol NO aparece etiquetada como coordinator',
       wrongTagInDirectorTab.length === 0,
       JSON.stringify(directorTabList));
    ok('2b · pestaña Director: la cuenta SÍ aparece correctamente etiquetada como director',
       directorTabList.some(s => s.uid === MULTI_ROLE_UID && s.role === 'director'));

    // 2c. Pestaña "Coordinador" (roles=['coordinator']) -> SOLO 'coordinator'.
    const coordTabList = await sandbox._cGetStaff({}, 'clubX', fns, ['coordinator']);
    const wrongTagInCoordTab = coordTabList.filter(s => s.uid === MULTI_ROLE_UID && s.role !== 'coordinator');
    ok('2c · [HUECO CERRADO] pestaña Coordinador: la cuenta multi-rol NO aparece etiquetada como director',
       wrongTagInCoordTab.length === 0,
       JSON.stringify(coordTabList));
    ok('2d · pestaña Coordinador: la cuenta SÍ aparece correctamente etiquetada como coordinator',
       coordTabList.some(s => s.uid === MULTI_ROLE_UID && s.role === 'coordinator'));

    // 2e. Uso por defecto (sin filtro, para despacho de informes colectivos)
    //     sigue incluyendo AMBOS roles — REGLA 1 no debe romper ese caso.
    const bothList = await sandbox._cGetStaff({}, 'clubX', fns, ['director', 'coordinator']);
    ok('2e · uso por defecto (informes colectivos, ambos roles): sigue trayendo AMBAS entradas',
       bothList.some(s => s.uid === MULTI_ROLE_UID && s.role === 'director') &&
       bothList.some(s => s.uid === MULTI_ROLE_UID && s.role === 'coordinator'));
}

run().then(() => {
    console.log(`\n${pass} PASS / ${fail} FAIL`);
    process.exit(fail ? 1 : 0);
}).catch(e => { console.error('ERROR ejecutando el test:', e); process.exit(1); });

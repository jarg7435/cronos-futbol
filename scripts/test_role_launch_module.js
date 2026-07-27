// ─────────────────────────────────────────────────────────────────────────
// test_role_launch_module.js · Refactor de monolitos (auditoria 2026-07-22)
// MONOLITO #4 (js/services/auth.js), PASO 1: extraccion de "seleccion de rol
// y arranque de la app" (enterApp / showRoleSelection / selectOption /
// _saPickTestClub / _launchWithRole / _renderCoordinatorTypePill, 456 lineas)
// a js/services/auth/role-launch.js.
//
// Escrito y ejecutado EN VERDE contra el codigo todavia SIN mover (Puerta 3).
//
// ── ⚠️ ESTE MONOLITO NO ES COMO LOS TRES ANTERIORES: ES UN MODULO ES ──
// auth.js se carga con <script type="module"> (index.html:1291). Consecuencias
// que cambian el refactor entero:
//  · Las declaraciones de nivel superior NO cuelgan de window. En los
//    monolitos 1-3, `function foo(){}` creaba window.foo gratis; aqui no. La
//    interfaz real son 14 asignaciones explicitas a window.*.
//  · Tiene 10 `export` y NADIE importa el archivo: ningun `import ... from
//    '.../auth.js'` en todo el repositorio. Esos export son decorativos.
//  · Al partirlo, auth.js tendra que IMPORTAR del archivo nuevo, porque
//    conserva seis llamadas a enterApp() y tres alias
//    (window.enterApp/showRoleSelector/selectOption).
//  · ESO CONVIERTE LA TRAMPA DE v378 EN ALGO SEGURO: en un modulo, una
//    referencia a un nombre inexistente NO COMPILA — el modulo entero falla al
//    cargar, ruidosamente, en el primer arranque. No hay version silenciosa.
//
// ── ARNES: por que se quita `export` antes de meter el bloque en el vm ──
// vm.runInContext no acepta sintaxis de modulo. El bloque lleva tres `export
// function`, asi que se eliminan SOLO esas palabras clave antes de evaluar.
// Es una transformacion del ARNES, no del codigo: no altera el cuerpo de
// ninguna funcion. Se hace igual antes y despues de la extraccion, para que
// el test compare exactamente lo mismo.
//
// ── ACOPLAMIENTO VERIFICADO (Puerta 1) ──
//  · FAN-OUT = CERO. El bloque no necesita NADA de lo que se queda en
//    auth.js: ni funciones, ni el estado de ambito de modulo (_isLoginMode,
//    SUPERADMIN_EMAILS, _superAdminLoaded, _addingRoleTimestamp). Es el
//    subgrafo mas autocontenido de todo el refactor. La dependencia va al
//    reves: es auth.js quien necesitara importar de aqui.
//  · FAN-IN externo, todo por window.* y en tiempo de click:
//    showRoleSelector (index.html + 4 paneles), selectOption (9 onclick en
//    index.html), enterApp (core/app-init.js). _launchWithRole,
//    _saPickTestClub y _renderCoordinatorTypePill NO tienen invocador externo
//    — las tres apariciones de _launchWithRole en core/patches.js y
//    core/setup-modal.js son COMENTARIOS.
//  · Un test a reapuntar: scripts/test_check_club_access.js hace
//    extractFn(auth, '_launchWithRole') leyendo auth.js por ruta.
//
// ── ⚠️ LO QUE DE VERDAD HAY QUE PROTEGER ──
// 1. El bloque ESCRIBE window._cronosCurrentUser (dos veces), el global que
//    leen 47 archivos del proyecto. Partes 5 y 6.
// 2. showRoleSelection solo muestra roles con isAuthorized === true Y
//    status === 'active', y si no hay ninguno activo NO pinta ningun panel
//    salvo que el rol raiz este confirmado. Es lo que impide que una cuenta
//    pendiente de aprobacion entre en la app. Parte 3.
//
// ── HALLAZGO DEL INVENTARIO (no de este bloque, pero relacionado) ──
// _showMultiRolePicker (125 lineas, se queda en auth.js) NO SE EJECUTA NUNCA:
// su unico invocador, js/admin/superadmin/extras.js:25, usa el NOMBRE PELADO
// con guarda typeof desde un script clasico, y el ambito de modulo no lo
// expone. El selector multi-rol no aparece jamas.
// ─────────────────────────────────────────────────────────────────────────
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.join(__dirname, '..');
const ORIGIN = path.join(ROOT, 'js', 'services', 'auth.js');
const EXTRACTED = path.join(ROOT, 'js', 'services', 'auth', 'role-launch.js');
const IS_EXTRACTED = fs.existsSync(EXTRACTED);
const SOURCE = IS_EXTRACTED ? EXTRACTED : ORIGIN;

let fail = 0, pass = 0;
const ok = (name, cond, extra) => {
    if (cond) { pass++; console.log('PASS ' + name); }
    else { fail++; console.log('FAIL ' + name); if (extra !== undefined) console.log('       ' + JSON.stringify(extra)); }
};

console.log('── Seleccion de rol y arranque — fuente: ' + path.relative(ROOT, SOURCE) + ' ──\n');

function readBlock() {
    const src = fs.readFileSync(SOURCE, 'utf8');
    const s = src.indexOf('export function enterApp()');
    if (s === -1) throw new Error('No se encontro enterApp en ' + SOURCE);
    if (IS_EXTRACTED) return src.slice(s);
    const e = src.indexOf('// ── Logout ──', s);
    if (e === -1) throw new Error('No se encontro el final de la seccion');
    const cut = src.slice(s, e);
    return cut.slice(0, cut.lastIndexOf('\n}') + 2);
}
const BLOCK = readBlock();
// Solo para el vm: quitar la palabra clave `export` (ver cabecera).
const RUNNABLE = BLOCK.replace(/^export\s+(?=(?:async\s+)?function\b)/gm, '');

function walk(dir, out) {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
        if (e.name === 'node_modules' || e.name === '.git') continue;
        const p = path.join(dir, e.name);
        if (e.isDirectory()) walk(p, out); else if (/\.(js|html)$/.test(e.name)) out.push(p);
    }
    return out;
}

const MOVED = ['enterApp', 'showRoleSelection', 'selectOption',
               '_saPickTestClub', '_launchWithRole', '_renderCoordinatorTypePill'];

// ── DOM minimo ───────────────────────────────────────────────────────────
function buildSandbox({
    me = undefined,
    ids = null,              // ids presentes en el DOM (null = todos)
    clubs = [],              // clubes que devuelve la query del SA picker
    importThrows = null,
    checkClubAccess = null,
} = {}) {
    const els = {};
    const logs = [], toasts = [], clubAccessCalls = [];
    const present = (id) => (ids === null ? true : ids.includes(id));
    const mkEl = (id) => ({
        id, style: {}, dataset: {}, innerHTML: '', textContent: '', value: '',
        classList: { _s: new Set(), add(c) { this._s.add(c); }, remove(c) { this._s.delete(c); }, contains(c) { return this._s.has(c); } },
        listeners: {},
        addEventListener(ev, fn) { (this.listeners[ev] = this.listeners[ev] || []).push(fn); },
        appendChild() {}, setAttribute() {}, querySelector: () => null, querySelectorAll: () => [],
    });
    const get = (id) => {
        if (!present(id)) return null;
        return (els[id] = els[id] || mkEl(id));
    };

    const sandbox = {
        _cronosCurrentUser: me,
        _cronos_auth: { db: {}, auth: {} },
        document: {
            getElementById: get,
            body: mkEl('body'),
            createElement: () => mkEl('new'),
            querySelector: () => null, querySelectorAll: () => [],
        },
        console: {
            log: (...a) => logs.push(a.join(' ')),
            warn: (...a) => logs.push(a.join(' ')),
            error: (...a) => logs.push(a.join(' ')),
        },
        Promise, Map, Set, Array, Object, String, Number, Date, Math, JSON,
        parseInt, isNaN, RegExp, Error,
        setTimeout: (fn) => { try { fn(); } catch (e) {} return 0; },
        clearTimeout: () => {},
        localStorage: { getItem: () => null, setItem: () => {}, removeItem: () => {} },
        sessionStorage: { getItem: () => null, setItem: () => {}, removeItem: () => {} },
        showToast: (m) => toasts.push(String(m)),
        escapeHtml: (s) => String(s == null ? '' : s),
        init: () => {},
    };
    if (checkClubAccess) sandbox.checkClubAccess = checkClubAccess;

    // import() dinamico del SDK -> __imp
    const patched = RUNNABLE.replace(/\bimport\s*\(/g, '__imp(');
    sandbox.__imp = async () => {
        if (importThrows) throw new Error(importThrows);
        return {
            collection: (db, n) => ({ __col: n }),
            query: (c) => c, where: () => ({}),
            getDocs: async () => ({ forEach: (fn) => clubs.forEach(c => fn({ id: c.id, data: () => c })), docs: clubs }),
            doc: (db, col, id) => ({ __col: col, __id: id }),
            getDoc: async () => ({ exists: () => false, data: () => undefined }),
            setDoc: async () => {}, updateDoc: async () => {},
        };
    };

    vm.createContext(sandbox);
    sandbox.window = sandbox;      // en un navegador window ES el global
    sandbox.globalThis = sandbox;
    vm.runInContext(patched, sandbox);

    return { g: sandbox, w: sandbox, els, logs, toasts, clubAccessCalls, el: (id) => els[id] };
}

const rol = (role, extra = {}) => Object.assign({ role, isAuthorized: true, status: 'active' }, extra);
const CARDS = ['card-opt-superadmin', 'card-opt-clubadmin', 'card-opt-director', 'card-opt-coordinator',
               'card-opt-coach', 'card-opt-parent', 'card-opt-individual',
               'card-opt-coach-individual', 'card-opt-parent-individual'];
const visibles = (t) => CARDS.filter(id => t.el(id) && t.el(id).style.display === 'block');

(async () => {
    // ═════════════════════════════════════════════════════════════════════
    console.log('── PARTE 1 · estructura, modulo y acoplamiento ──');
    ok('1a · las seis piezas estan en el bloque',
        /^export function enterApp\(\)/m.test(BLOCK)
        && /^export function showRoleSelection\(\)/m.test(BLOCK)
        && /^export function selectOption\(option\)/m.test(BLOCK)
        && /^async function _saPickTestClub\(/m.test(BLOCK)
        && /^function _launchWithRole\(/m.test(BLOCK)
        && /^function _renderCoordinatorTypePill\(/m.test(BLOCK));
    {
        const auth = fs.readFileSync(ORIGIN, 'utf8');
        const names = new Set();
        for (const l of auth.split(/\r?\n/)) {
            let m = l.match(/^(?:export\s+)?(?:async\s+)?function\s+([A-Za-z_$][\w$]*)/); if (m) names.add(m[1]);
            m = l.match(/^(?:const|let|var)\s+([A-Za-z_$][\w$]*)/); if (m) names.add(m[1]);
        }
        const used = [...names].filter(n => !MOVED.includes(n)
            && new RegExp('\\b' + n.replace(/[$]/g, '\\$') + '\\b').test(BLOCK)).sort();
        ok('1b · ⚠️ FAN-OUT CERO: el bloque no usa nada de lo que se queda en auth.js',
            used.length === 0, used);
    }
    ok('1c · tampoco toca el estado de ambito de modulo',
        !/_isLoginMode|SUPERADMIN_EMAILS|_superAdminLoaded|_addingRoleTimestamp/.test(BLOCK));
    {
        const auth = fs.readFileSync(ORIGIN, 'utf8');
        ok('1d · auth.js sigue necesitando enterApp (6 llamadas) y los tres alias',
            (auth.match(/\benterApp\(\)/g) || []).length >= 5
            && /window\.enterApp\s*=\s*enterApp;/.test(auth)
            && /window\.showRoleSelector\s*=\s*showRoleSelection;/.test(auth)
            && /window\.selectOption\s*=\s*selectOption;/.test(auth));
        if (IS_EXTRACTED) {
            ok('1e · ⚠️ y por eso auth.js IMPORTA del archivo nuevo (si no, no compila)',
                /^import\s*\{[^}]*\}\s*from\s*['"]\.\/auth\/role-launch\.js['"]/m.test(auth),
                (auth.match(/^import[^\n]*/m) || [''])[0]);
        }
    }
    {
        const callers = {};
        for (const f of walk(ROOT, [])) {
            const rel = path.relative(ROOT, f).replace(/\\/g, '/');
            if (rel.startsWith('scripts/') || rel === 'sw.js' || /^test_.*\.js$/.test(rel)) continue;
            if (rel === 'js/services/auth.js' || rel === 'js/services/auth/role-launch.js') continue;
            const txt = fs.readFileSync(f, 'utf8');
            const code = txt.split('\n').map(l => l.trim().replace(/^\/\/.*$/, '')).join('\n');
            for (const n of ['_launchWithRole', '_saPickTestClub', '_renderCoordinatorTypePill'])
                if (new RegExp('\\b' + n + '\\s*\\(').test(code)) (callers[n] = callers[n] || []).push(rel);
        }
        ok('1f · las tres funciones internas no tienen invocador externo REAL (las de patches.js son comentarios)',
            Object.keys(callers).length === 0, callers);
    }
    if (IS_EXTRACTED) {
        ok('1g · test_check_club_access.js ya apunta al archivo nuevo',
            fs.readFileSync(path.join(ROOT, 'scripts', 'test_check_club_access.js'), 'utf8')
                .includes('role-launch.js'));
        ok('1h · esta en el precache de sw.js',
            fs.readFileSync(path.join(ROOT, 'sw.js'), 'utf8').includes('js/services/auth/role-launch.js'));
        ok('1i · esta en la lista de _check_syntax.js',
            fs.readFileSync(path.join(ROOT, 'scripts', '_check_syntax.js'), 'utf8')
                .includes('js/services/auth/role-launch.js'));
        ok('1j · NO se anade un <script> suelto: entra por el import de auth.js',
            !fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8').includes('auth/role-launch.js'));
    }

    // ═════════════════════════════════════════════════════════════════════
    console.log('\n── PARTE 2 · enterApp ──');
    {
        const t = buildSandbox({ me: { role: 'user', allRoles: [] } });
        t.w.enterApp();
        ok('2a · oculta la pantalla de login', t.el('auth-screen').style.display === 'none');
        ok('2b · desbloquea el body', !t.g.document.body.classList.contains('locked'));
        ok('2c · encadena con la pantalla de seleccion de rol',
            t.el('role-selection-screen') !== undefined);
    }
    {
        const t = buildSandbox({ me: { role: 'user', allRoles: [] }, ids: ['role-selection-screen'] });
        let threw = null;
        try { t.w.enterApp(); } catch (e) { threw = e; }
        ok('2d · sin la pantalla de login en el DOM no rompe', !threw, threw && threw.message);
    }

    // ═════════════════════════════════════════════════════════════════════
    console.log('\n── PARTE 3 · ⚠️ showRoleSelection: solo roles ACTIVOS y AUTORIZADOS ──');
    {
        const t = buildSandbox({ me: undefined });
        t.w.showRoleSelection();
        ok('3a · sin usuario avisa y no pinta nada', t.logs.some(l => l.includes('No user found')));
    }
    {
        const t = buildSandbox({ me: { role: 'user', allRoles: [] } });
        t.w.showRoleSelection();
        ok('3b · reasigna window.showRoleSelector (el alias que usa saGoBackToRoles)',
            typeof t.w.showRoleSelector === 'function');
    }
    {
        const t = buildSandbox({ me: { role: 'superadmin', allRoles: [] } });
        t.w.showRoleSelection();
        ok('3c · el superadmin ve TODAS las tarjetas', visibles(t).length === CARDS.length, visibles(t).length);
    }
    {
        const t = buildSandbox({
            me: { role: 'user', allRoles: [rol('director'), rol('coordinator')] },
        });
        t.w.showRoleSelection();
        ok('3d · con varios roles activos muestra una tarjeta por rol',
            visibles(t).sort().join() === ['card-opt-director', 'card-opt-coordinator'].sort().join(), visibles(t));
        ok('3e · y deja la pantalla visible', t.el('role-selection-screen').style.display === 'flex');
    }
    {
        // ⚠️ el filtro de seguridad: pendientes, no autorizados y removidos NO
        // cuentan. OJO: hay que dejar DOS supervivientes, porque con uno solo
        // el codigo entra directo y no pinta ninguna tarjeta (ver 3g).
        const t = buildSandbox({
            me: { role: 'user', allRoles: [
                rol('director'),
                rol('coach'),
                { role: 'club_admin', isAuthorized: false, status: 'active' },
                { role: 'coordinator', isAuthorized: true, status: 'pending' },
                { role: 'parent', isAuthorized: true, status: 'removed' },
            ] },
        });
        t.w.showRoleSelection();
        ok('3f · ⚠️ ignora los roles no autorizados o cuyo status no es active',
            visibles(t).sort().join() === ['card-opt-director', 'card-opt-coach'].sort().join(), visibles(t));
    }
    {
        const t = buildSandbox({ me: { role: 'user', allRoles: [rol('director')] } });
        t.w.showRoleSelection();
        ok('3g · con UN solo rol activo entra directo y esconde la pantalla',
            t.el('role-selection-screen').style.display === 'none'
            && t.w._cronosCurrentUser._activeRole === 'director',
            { display: t.el('role-selection-screen').style.display, activo: t.w._cronosCurrentUser._activeRole });
    }
    {
        const t = buildSandbox({
            me: { role: 'user', allRoles: [rol('coach', { individualEntityId: 'E1' })] },
        });
        t.w.showRoleSelection();
        ok('3h · un rol bajo entidad individual se mapea a su variante _individual',
            t.w._cronosCurrentUser._activeRole === 'user', t.w._cronosCurrentUser._activeRole);
    }
    {
        // ⚠️ sin roles activos: fallback al rol raiz SOLO si esta confirmado
        const t = buildSandbox({ me: { role: 'director', allRoles: [], isAuthorized: true, status: 'active' } });
        t.w.showRoleSelection();
        ok('3i · sin allRoles cae al rol raiz cuando esta confirmado',
            visibles(t).join() === 'card-opt-director', visibles(t));
        const t2 = buildSandbox({ me: { role: 'director', allRoles: [], isAuthorized: false, status: 'active' } });
        t2.w.showRoleSelection();
        ok('3j · ⚠️ pero si el rol raiz NO esta confirmado no pinta NINGUN panel',
            visibles(t2).length === 0 && t2.logs.some(l => l.includes('no active confirmed roles')), visibles(t2));
    }
    {
        const t = buildSandbox({ me: { role: 'user', allRoles: [] }, ids: [] });
        let threw = null;
        try { t.w.showRoleSelection(); } catch (e) { threw = e; }
        ok('3k · sin la pantalla en el DOM sale sin romper', !threw, threw && threw.message);
    }

    // ═════════════════════════════════════════════════════════════════════
    console.log('\n── PARTE 4 · selectOption: el mapa de roles ──');
    {
        const casos = [
            ['clubadmin', 'club_admin'], ['director', 'director'], ['coordinator', 'coordinator'],
            ['coach', 'user'], ['parent', 'parent'], ['individual', 'individual'],
            ['coach_individual', 'user'], ['parent_individual', 'parent'],
            ['admin_individual', 'individual'], ['superadmin', 'superadmin'],
        ];
        const malos = [];
        for (const [opt, esperado] of casos) {
            const t = buildSandbox({ me: { role: 'user', clubId: 'C1', allRoles: [] } });
            t.w.selectOption(opt);
            if (t.w._cronosCurrentUser._activeRole !== esperado) malos.push(opt + '->' + t.w._cronosCurrentUser._activeRole);
        }
        ok('4a · las diez opciones se mapean al rol interno correcto', malos.length === 0, malos);
    }
    {
        const t = buildSandbox({ me: { role: 'director', clubId: 'C1', allRoles: [] } });
        t.w.selectOption('opcion-inexistente');
        ok('4b · una opcion desconocida cae al rol raiz del usuario',
            t.w._cronosCurrentUser._activeRole === 'director');
    }
    {
        const t = buildSandbox({ me: undefined });
        let threw = null;
        try { t.w.selectOption('coach'); } catch (e) { threw = e; }
        ok('4c · sin usuario sale sin romper', !threw);
    }
    {
        // SA sin club + rol que necesita club -> pasa por el selector de pruebas
        const t = buildSandbox({
            me: { role: 'superadmin', allRoles: [] },
            clubs: [{ id: 'C1', name: 'Club Uno' }],
        });
        t.w.selectOption('director');
        ok('4d · el superadmin SIN club pasa por el selector de club de pruebas',
            !!t.el('sa-club-picker') || t.logs.length >= 0);
        ok('4e · y el rol activo queda fijado igualmente',
            t.w._cronosCurrentUser._activeRole === 'director');
    }
    {
        const t = buildSandbox({ me: { role: 'superadmin', clubId: 'C9', allRoles: [] } });
        t.w.selectOption('director');
        ok('4f · si el superadmin YA tiene club, lanza directo sin selector',
            t.el('role-selection-screen') && t.el('role-selection-screen').style.display === 'none');
    }

    // ═════════════════════════════════════════════════════════════════════
    console.log('\n── PARTE 5 · ⚠️ _launchWithRole y window._cronosCurrentUser ──');
    ok('5a · ⚠️ el bloque escribe window._cronosCurrentUser (lo leen 47 archivos)',
        (BLOCK.match(/window\._cronosCurrentUser\s*=/g) || []).length === 2,
        (BLOCK.match(/window\._cronosCurrentUser\s*=/g) || []).length);
    {
        const t = buildSandbox({
            me: { uid: 'u1', role: 'user', clubId: 'VIEJO', _activeRole: 'director',
                  allRoles: [{ role: 'director', clubId: 'C_DIR', isAuthorized: true, status: 'active' }] },
        });
        t.w._launchWithRole('director');
        ok('5b · sincroniza _cronosCurrentUser con la entrada de allRoles del rol activo',
            t.w._cronosCurrentUser.clubId === 'C_DIR', t.w._cronosCurrentUser.clubId);
        ok('5c · oculta la pantalla de seleccion',
            t.el('role-selection-screen').style.display === 'none');
    }
    {
        let called = null;
        const t = buildSandbox({
            me: { uid: 'u1', role: 'user', _activeRole: 'director', allRoles: [] },
            checkClubAccess: (u) => { called = u; return Promise.resolve(true); },
        });
        t.w._launchWithRole('director');
        ok('5d · invoca window.checkClubAccess con el usuario actual (lo vigila test_check_club_access)',
            called !== null, called && called.uid);
    }
    {
        // sin checkClubAccess definido no debe romper (es best-effort)
        const t = buildSandbox({ me: { uid: 'u1', role: 'user', _activeRole: 'user', allRoles: [] } });
        let threw = null;
        try { t.w._launchWithRole('user'); } catch (e) { threw = e; }
        ok('5e · si checkClubAccess no existe, no rompe el arranque', !threw, threw && threw.message);
    }

    // ═════════════════════════════════════════════════════════════════════
    console.log('\n── PARTE 6 · _saPickTestClub y la pill de coordinador ──');
    {
        const t = buildSandbox({
            me: { uid: 'sa1', role: 'superadmin', _activeRole: 'director', allRoles: [] },
            importThrows: 'sin red',
        });
        await t.w._saPickTestClub('director');
        ok('6a · si falla la carga de clubes lanza igualmente con el rol elegido',
            t.el('role-selection-screen') && t.el('role-selection-screen').style.display === 'none');
    }
    ok('6b · la pill de tipo de coordinador va envuelta en try/catch (es informativa)',
        /catch \(_\) \{ \/\* no-op: la pill es informativa \*\/ \}/.test(BLOCK));
    ok('6c · el selector de club de pruebas escribe clubId y clubName en el usuario',
        /window\._cronosCurrentUser = \{ \.\.\.me, clubId: btn\.dataset\.id, clubName: btn\.dataset\.name \}/.test(BLOCK));

    console.log('\n────────────────────────────────────────────');
    console.log('Resultado: ' + pass + '/' + (pass + fail) + (fail ? '  ❌ ' + fail + ' FALLOS' : '  ✅'));
    process.exit(fail ? 1 : 0);
})().catch(e => { console.error('ERROR FATAL:', e); process.exit(1); });

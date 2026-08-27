// ─────────────────────────────────────────────────────────────────────────
// test_contact_manager_crash.js  ·  "Cannot read properties of undefined
// (reading 'push')" al abrir el Gestor de Contactos (botón CONTACTOS)
//
// Causa: openContactManager() usaba en TODO su cuerpo la variable GLOBAL
// `emailConfig` (sin `window.`), declarada con `let emailConfig = {...}` en
// js/core/app-init.js SIN campo `contacts`. Los dos guards defensivos del
// principio sólo inicializaban `window.emailConfig` — una variable DISTINTA
// que el resto de la función nunca lee (son dos bindings con el mismo nombre:
// un `let` de nivel de script NO cuelga de `window`). La ganadora de las 3
// copias de `loadEmailConfig` sólo rellena `.contacts` si YA hay algo en
// localStorage, así que en cualquier navegador/cuenta que nunca haya guardado
// contactos, `emailConfig.contacts` era `undefined` y el primer `.push()`
// reventaba.
//
// Este test carga el código REAL de openContactManager en un sandbox que
// reproduce esa condición (emailConfig SIN contacts, localStorage vacío).
//
// ══════════════════════════════════════════════════════════════════════════
//  ⚠️ 2026-08-27 · TRES ASERCIONES BUSCABAN UNA FORMULACIÓN QUE CAMBIÓ
//
//  1b/1c/1d exigían el guard escrito con esta forma exacta:
//      if (typeof emailConfig === 'undefined') emailConfig = { contacts: [] };
//      if (!emailConfig.contacts) emailConfig.contacts = [];
//  El guard sigue estando —y sobre el binding correcto, que era el fondo del
//  asunto— pero escrito como una sola comprobación combinada dentro del try
//  (`if (!emailConfig || !emailConfig.contacts) { ... }`). Se mide eso.
//
//  🚨 Y 2c ("el director y el coordinador se añadieron") fallaba por una razón
//     distinta y peor: el alta del staff dejó de hacerse con una consulta
//     inline y pasa por _cGetStaff + _cFS, que el sandbox no ofrecía. La
//     llamada moría en su `catch(sErr)` —que sólo hace warn— y la lista salía
//     sin staff. O sea: el arnés se quedó atrás y el fallo PARECÍA del
//     producto. Ahora el sandbox monta el _cGetStaff REAL de panel.js, así que
//     2c vuelve a probar el camino entero.
// ══════════════════════════════════════════════════════════════════════════
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.join(__dirname, '..');
let fail = 0, pass = 0;
const ok = (name, cond, extra) => {
    if (cond) { pass++; console.log('PASS ' + name); }
    else { fail++; console.log('FAIL ' + name); if (extra !== undefined) console.log('       ' + extra); }
};

console.log('── Crash del Gestor de Contactos (emailConfig.contacts undefined) ──\n');

// openContactManager se extrajo a js/coach/comms/contact-manager.js en el paso
// 4 del refactor del monolito #3 (auditoría 2026-07-22). Se lee de allí si el
// archivo existe.
const _CM = path.join(ROOT, 'js', 'coach', 'comms', 'contact-manager.js');
const src = fs.readFileSync(
    fs.existsSync(_CM) ? _CM : path.join(ROOT, 'js', 'coach', 'comms', 'panel.js'), 'utf8');
const panelSrc = fs.readFileSync(path.join(ROOT, 'js', 'coach', 'comms', 'panel.js'), 'utf8');

// ═══════════════════ PARTE 1 · estructura del código real ══════════════════
console.log('── PARTE 1 · estructura ──');
const fnStart = src.indexOf('async function openContactManager()');
ok('1a · existe openContactManager', fnStart !== -1);
const fnBody = src.slice(fnStart, src.indexOf('\nasync function ', fnStart + 10));

// 🔑 LO QUE IMPORTA ES EL BINDING, NO LA REDACCIÓN: el guard tiene que tocar
//    `emailConfig` a secas (el `let` de app-init.js, que es el que lee el resto
//    de la función), no `window.emailConfig`, que es OTRA variable.
ok('1b · [FIX] el guard asegura el binding LÉXICO emailConfig, no window.emailConfig',
   /if \(!emailConfig \|\| !emailConfig\.contacts\) \{/.test(fnBody),
   'window.emailConfig es otra variable: inicializarla no evita el crash');
ok('1c · [FIX] deja emailConfig.contacts como array antes del primer push',
   /if \(!emailConfig \|\| !emailConfig\.contacts\) \{[\s\S]{0,200}emailConfig\.contacts = \[\];/.test(fnBody));

// El fix debe estar ANTES del primer uso real (el push que revienta).
const fixIdx   = fnBody.indexOf('emailConfig.contacts = [];');
const firstUse = fnBody.indexOf('emailConfig.contacts.push');
ok('1d · el fix se aplica ANTES del primer emailConfig.contacts.push',
   fixIdx !== -1 && firstUse !== -1 && fixIdx < firstUse, { fixIdx, firstUse });

// ═══════════════════ PARTE 2 · ejecución REAL en sandbox ═══════════════════
console.log('\n── PARTE 2 · ejecución del código real (condición exacta del crash) ──');

function extractPanelFn(name) {
    const start = panelSrc.search(new RegExp('(?:async )?function ' + name + '\\('));
    if (start === -1) throw new Error('No se encontró ' + name + ' en panel.js');
    let depth = 0, started = false, end = start;
    for (let i = start; i < panelSrc.length; i++) {
        if (panelSrc[i] === '{') { depth++; started = true; }
        if (panelSrc[i] === '}') { depth--; if (started && depth === 0) { end = i; break; } }
    }
    return panelSrc.slice(start, end + 1);
}

// Usuarios del club en "Firestore". Los stubs APLICAN los where(), así que
// _cGetStaff se ejerce de verdad y no da lo mismo cómo consulte.
const USERS = {
    directorUID: { displayName: 'Director',    email: 'dir@club.com',   role: 'director',    clubId: 'clubX' },
    coordUID:    { displayName: 'Coordinador', email: 'coord@club.com', role: 'coordinator', clubId: 'clubX' },
    coachUID:    { displayName: 'Yo',          email: 'coach@club.com', role: 'user',        clubId: 'clubX' },
};

async function run() {
    const firestore = {
        collection: (_db, name) => ({ __col: name }),
        where: (field, _op, value) => ({ field, value }),
        query: (col, ...cs) => ({ __col: col.__col, cs }),
        getDocs: async (q) => {
            if (q.__col !== 'users') return { forEach: () => {} };   // cronos_player_links: vacío
            const docs = Object.entries(USERS)
                .filter(([, u]) => (q.cs || []).every(c => u[c.field] === c.value))
                .map(([id, u]) => ({ id, data: () => u }));
            return { forEach: (cb) => docs.forEach(cb), size: docs.length };
        },
        doc: () => ({}),
        getDoc: async () => ({ exists: () => false }),
    };

    const sandbox = {
        window: {
            _cronosCurrentUser: { uid: 'coachUID', email: 'coach@club.com', clubId: 'clubX' },
            _cronos_auth: { db: {} },
        },
        // Reproduce EXACTAMENTE la condición del bug: `let emailConfig` sin
        // `contacts`, y loadEmailConfig() que NO lo rellena porque no hay nada
        // en localStorage (cuenta/navegador nunca usado antes).
        emailConfig: { coachEmail: '', directorEmail: '', whatsappNumber: '' },
        loadEmailConfig: function () { /* localStorage vacío: no hace nada, como en producción */ },
        showSpinner: () => {}, hideSpinner: () => {}, showToast: () => {},
        console: { log() {}, warn() {}, error() {} },
        localStorage: { getItem: () => null, setItem: () => {} },
        document: { getElementById: () => ({ style: {}, innerHTML: '' }) },
        currentMode: 'f11',
        renderContactRowMarkup: () => '',
        renderParentRowMarkup: () => '',
        _catAndSubcatMatch: () => true,
        _cFS: async () => Object.assign({ db: {} }, firestore),
        Array, Map, Math, JSON, Object,
    };
    // La función usa `import(...)` dinámico -> se sustituye por __imp, igual
    // que en el resto de tests del proyecto.
    sandbox.__imp = async () => firestore;

    vm.createContext(sandbox);
    // 🔑 _cGetStaff REAL, extraído de panel.js: es quien alimenta el alta del
    //    staff desde v593. Si vuelve a cambiar de forma, este test lo nota.
    vm.runInContext(extractPanelFn('_cGetStaff'), sandbox, { filename: '_cGetStaff.js' });
    vm.runInContext(fnBody.replace(/\bimport\s*\(/g, '__imp('), sandbox, { filename: 'openContactManager.js' });

    let threw = null;
    try {
        await sandbox.openContactManager();
    } catch (e) {
        threw = e;
    }

    ok('2a · openContactManager() NO lanza "Cannot read properties of undefined"',
       !threw, threw ? (threw.message || String(threw)) : undefined);
    ok('2b · emailConfig.contacts terminó siendo un array', Array.isArray(sandbox.emailConfig.contacts));
    const uids = (sandbox.emailConfig.contacts || []).map(c => c.uid);
    ok('2c · el director y el coordinador del club se añadieron a los contactos',
       uids.includes('directorUID') && uids.includes('coordUID'), JSON.stringify(uids));
    ok('2d · y el entrenador (rol no pedido) NO entra como staff',
       !(sandbox.emailConfig.contacts || []).some(c => c.type === 'staff' && c.uid === 'coachUID'),
       JSON.stringify((sandbox.emailConfig.contacts || []).map(c => c.uid + ':' + c.type)));
    ok('2e · cada uno con su rol REAL (el director no sale etiquetado de coordinador ni al revés)',
       (sandbox.emailConfig.contacts || []).some(c => c.uid === 'directorUID' && c.role === 'director') &&
       (sandbox.emailConfig.contacts || []).some(c => c.uid === 'coordUID' && c.role === 'coordinator'),
       JSON.stringify((sandbox.emailConfig.contacts || []).map(c => c.uid + ':' + c.role)));
}

run().then(() => {
    console.log('\n' + pass + ' PASS / ' + fail + ' FAIL');
    process.exit(fail ? 1 : 0);
}).catch(e => { console.error('ERROR ejecutando el test:', e); process.exit(1); });

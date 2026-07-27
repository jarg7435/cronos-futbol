// ─────────────────────────────────────────────────────────────────────────
// test_extracted_modules_load.js · Refactor de monolitos (auditoria 2026-07-22)
//
// RED DE SEGURIDAD PARA TODO EL REFACTOR. Nace de un fallo REAL introducido
// en el paso 4 del monolito #3 y que llego a produccion:
//
//   panel.js conservaba `window.openContactManager = openContactManager;` con
//   el nombre PELADO, pero openContactManager se habia mudado a
//   contact-manager.js, que se carga DESPUES. En el navegador eso es un
//   ReferenceError EN TIEMPO DE CARGA que aborta el resto de panel.js: se
//   perdio window._cronosForceRedispatch y quedo un error no capturado en la
//   consola en cada arranque.
//
// Por que no lo vio nadie: los tests dedicados de cada extraccion cargan el
// BLOQUE movido en un sandbox, nunca el archivo ORIGEN entero, asi que un
// alias colgado al final del origen no lo ejercita ninguno. Y la funcion
// seguia funcionando en la app porque contact-manager.js la publica igual al
// ser una declaracion de funcion — el sintoma era invisible salvo en consola.
//
// Este archivo cubre ese hueco de dos formas:
//   PARTE 1 (estatica): ningun alias de nivel superior `window.X = nombre;`
//   puede apuntar a un nombre que no se declare en ESE MISMO archivo.
//   PARTE 2 (runtime): los cinco archivos de coach/comms se cargan en cadena,
//   en el orden real de index.html, en un sandbox donde `window` ES el objeto
//   global (como en un navegador), y ninguno puede lanzar.
//
// ⚠️ OJO CON EL SANDBOX: si `window` es un objeto APARTE del global del
// contexto, `window.X = ...` no crea un binding resoluble por nombre pelado y
// el test da falsos positivos (me paso al diagnosticar este mismo fallo: el
// primer sandbox culpaba a openThreadWithParent, que es inocente). `window`
// TIENE que ser el propio objeto de contexto.
// ─────────────────────────────────────────────────────────────────────────
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.join(__dirname, '..');
let fail = 0, pass = 0;
const ok = (name, cond, extra) => {
    if (cond) { pass++; console.log('PASS ' + name); }
    else { fail++; console.log('FAIL ' + name); if (extra !== undefined) console.log('       ' + JSON.stringify(extra)); }
};

console.log('── Carga de los modulos extraidos ──\n');

// Los archivos producidos por el refactor mas los monolitos de origen.
const FILES = [
    'js/coach/comms/panel.js',
    'js/coach/comms/training-notify.js',
    'js/coach/comms/collective-report.js',
    'js/coach/comms/individual-reports.js',
    'js/coach/comms/contact-manager.js',
    'js/coach/comms/bulk-messaging.js',
    'js/coach/comms/match-reports-send.js',
    'js/coach/comms/match-reports-auto.js',
    'js/coach/reports/club-reports.js',
    'js/coach/reports/report-engine.js',
    'js/coach/reports/director-config.js',
    'js/coach/reports/events-tab.js',
    'js/coach/reports/finished-matches-tab.js',
    'js/coach/reports/reports-tab.js',
    'js/admin/superadmin/superadmin.panel.js',
].filter(f => fs.existsSync(path.join(ROOT, f)));

console.log('── PARTE 1 · ningun alias apunta a un nombre que ya no esta en su archivo ──');
// `window.X = null;` es un valor, no una referencia: no puede lanzar.
const LITERALS = new Set(['null', 'undefined', 'true', 'false', 'NaN', 'Infinity', 'this', 'window', 'globalThis']);

function danglingAliases(src) {
    const declared = new Set();
    for (const l of src.split(/\r?\n/)) {
        let m = l.match(/^(?:async\s+)?function\s+([A-Za-z_$][\w$]*)/); if (m) declared.add(m[1]);
        m = l.match(/^(?:const|let|var)\s+([A-Za-z_$][\w$]*)/); if (m) declared.add(m[1]);
        // Solo cuenta como definicion si el lado derecho CREA algo. Un
        // `window.X = X;` no define nada: es justo lo que buscamos.
        m = l.match(/^window\.([A-Za-z_$][\w$]*)\s*=\s*(?:async\s+)?(?:function|\(|\{|[A-Za-z_$][\w$]*\s*=>)/);
        if (m) declared.add(m[1]);
    }
    const out = [];
    src.split(/\r?\n/).forEach((l, i) => {
        const m = l.match(/^window\.([A-Za-z_$][\w$]*)\s*=\s*([A-Za-z_$][\w$]*)\s*;/);
        if (!m || LITERALS.has(m[2]) || declared.has(m[2])) return;
        out.push({ line: i + 1, text: l.trim() });
    });
    return out;
}
{
    // Auto-prueba: el detector TIENE que reconocer el fallo historico y no
    // marcar sus dos vecinos inocentes. Sin esto, un 1b en verde no probaria
    // nada el dia que la expresion regular deje de casar.
    const sample = [
        'function vive() {}',
        'window.openCollectiveReport = window.openCollectiveReport;',
        'window.vive = vive;',
        'window._flag = null;',
        'window.openContactManager      = openContactManager;',
    ].join('\n');
    const found = danglingAliases(sample).map(o => o.line);
    ok('1a · el detector reconoce el caso historico y no marca a los inocentes',
        JSON.stringify(found) === JSON.stringify([5]), found);
}
{
    const offenders = [];
    for (const rel of FILES) {
        for (const o of danglingAliases(fs.readFileSync(path.join(ROOT, rel), 'utf8')))
            offenders.push(rel + ':' + o.line + '  ' + o.text);
    }
    ok('1b · ⚠️ ningun `window.X = <nombre pelado>` cuelga de un nombre ausente (ReferenceError en carga)',
        offenders.length === 0, offenders);
}

console.log('\n── PARTE 2 · la cadena de coach/comms se carga entera sin lanzar ──');
{
    // Orden real de index.html, no uno inventado.
    const idx = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
    const chain = FILES.filter(f => f.startsWith('js/coach/comms/'))
        .map(f => ({ f, at: idx.indexOf(f) }))
        .filter(x => x.at !== -1)
        .sort((a, b) => a.at - b.at)
        .map(x => x.f);
    // 5 tras el paso 4, 6 tras el paso 5. Se deriva de FILES para que anadir
    // un modulo nuevo a la lista de arriba baste.
    const expectedChain = FILES.filter(f => f.startsWith('js/coach/comms/')).length;
    ok('2a · todos los archivos de comms estan enlazados en index.html',
        chain.length === expectedChain, { chain, expectedChain });

    const noop = () => {};
    const stubEl = () => ({ style: {}, dataset: {}, innerHTML: '', value: '', checked: false,
        options: [], classList: { add: noop, remove: noop, toggle: noop },
        appendChild: noop, remove: noop, focus: noop, addEventListener: noop,
        querySelector: () => null, querySelectorAll: () => [] });
    const sb = {
        document: {
            getElementById: () => null, createElement: stubEl,
            querySelector: () => null, querySelectorAll: () => [],
            addEventListener: noop, body: stubEl(), head: stubEl(),
        },
        console: { log: noop, warn: noop, error: noop, info: noop, debug: noop },
        localStorage: { getItem: () => null, setItem: noop, removeItem: noop },
        sessionStorage: { getItem: () => null, setItem: noop, removeItem: noop },
        setTimeout: () => 0, clearTimeout: noop, setInterval: () => 0, clearInterval: noop,
        navigator: { userAgent: 'node' }, location: { href: '', origin: '' },
        fetch: async () => ({ ok: true, json: async () => ({}) }),
        alert: noop, confirm: () => false, prompt: () => null,
        escapeHtml: (s) => String(s == null ? '' : s), escapeAttr: (s) => String(s == null ? '' : s),
        showToast: noop, showSpinner: noop, hideSpinner: noop,
        emailConfig: { contacts: [] }, currentMode: 'f11',
        TEAM_NAMES: { home: '', away: '' },
    };
    vm.createContext(sb);
    // ⚠️ CLAVE: en un navegador `window` ES el objeto global.
    sb.window = sb;
    sb.globalThis = sb;
    sb.self = sb;

    const errors = [];
    for (const rel of chain) {
        try { vm.runInContext(fs.readFileSync(path.join(ROOT, rel), 'utf8'), sb, { filename: rel }); }
        catch (e) { errors.push(rel + ' -> ' + e.constructor.name + ': ' + e.message); }
    }
    ok('2b · ⚠️ ninguno lanza al cargarse en cadena', errors.length === 0, errors);

    // Lo que se perdia cuando panel.js abortaba a mitad del bloque de exports.
    // ⚠️ NO anadir aqui el nombre de la funcion de "notificacion de
    // entrenamiento": test_training_notify_module.js:1g aserta que NINGUN otro
    // test del repositorio la nombra, y anadirla pondria ese test en rojo. Su
    // archivo ya queda cubierto por 2b, que lo carga y exige que no lance.
    const mustExist = ['openUnifiedCommsMenu', 'saveAllMatchReportsInternal',
                       '_cronosForceRedispatch', 'openContactManager',
                       'saveContactManagerData', 'openMisInformes',
                       'openCollectiveReport'];
    const missing = mustExist.filter(n => typeof sb.window[n] !== 'function');
    ok('2c · tras cargar la cadena, las funciones publicas del panel estan en window',
        missing.length === 0, missing);
    ok('2d · en particular _cronosForceRedispatch, que es lo que se perdia tras el error',
        typeof sb.window._cronosForceRedispatch === 'function');
}

console.log('\n── PARTE 3 · modulos ES: cada `import` resuelve a un `export` real ──');
// El monolito #4 (js/services/auth.js) es un MODULO ES, no un script clasico:
// la parte 2 no le aplica. Su riesgo equivalente es un `import { X }` cuyo
// nombre no exista en el archivo de origen — un error de ENLACE que node
// --check NO detecta (parsea cada archivo por separado) y que en el navegador
// tumba el modulo entero al arrancar. Esto lo cubre.
{
    const MODULES = ['js/services/auth.js', 'js/services/auth/role-launch.js']
        .filter(f => fs.existsSync(path.join(ROOT, f)));
    const exportsOf = (src) => new Set([
        ...[...src.matchAll(/^export\s+(?:async\s+)?function\s+([A-Za-z_$][\w$]*)/gm)].map(m => m[1]),
        ...[...src.matchAll(/^export\s+(?:const|let|var)\s+([A-Za-z_$][\w$]*)/gm)].map(m => m[1]),
    ]);
    const rotos = [];
    let comprobados = 0;
    for (const rel of MODULES) {
        const abs = path.join(ROOT, rel);
        const src = fs.readFileSync(abs, 'utf8');
        for (const m of src.matchAll(/import\s*\{([^}]+)\}\s*from\s*['"]([^'"]+)['"]/g)) {
            const spec = m[2];
            if (!spec.startsWith('.')) continue;               // sólo rutas locales
            const target = path.resolve(path.dirname(abs), spec);
            if (!fs.existsSync(target)) { rotos.push(rel + ' -> ' + spec + ' (archivo inexistente)'); continue; }
            const disponibles = exportsOf(fs.readFileSync(target, 'utf8'));
            for (const raw of m[1].split(',')) {
                const n = raw.trim().split(/\s+as\s+/)[0].trim();
                if (!n) continue;
                comprobados++;
                if (!disponibles.has(n)) rotos.push(rel + ': importa `' + n + '` de ' + spec + ', que no lo exporta');
            }
        }
    }
    ok('3a · ⚠️ todo `import { X } from "./y.js"` encuentra su export (node --check NO ve esto)',
        rotos.length === 0, rotos);
    ok('3b · y la comprobacion ha mirado algo de verdad', comprobados > 0, { nombres: comprobados });
}
{
    // ⚠️ LA OTRA CARA DEL MISMO PROBLEMA, y la que causo un fallo REAL:
    // un SCRIPT CLASICO que referencia por NOMBRE PELADO algo que solo existe
    // en el ambito de un MODULO ES. El ambito de modulo no cuelga de window,
    // asi que `typeof loQueSea === 'function'` es SIEMPRE 'undefined' y la
    // rama muere en silencio. Asi es como el boton "Rol" del panel SuperAdmin
    // acabo devolviendo al usuario a la pantalla de login (arreglado 2026-07-27).
    const MODULES = ['js/services/auth.js', 'js/services/auth/role-launch.js']
        .filter(f => fs.existsSync(path.join(ROOT, f)));
    const declarados = new Set(), expuestos = new Set();
    for (const rel of MODULES) {
        const src = fs.readFileSync(path.join(ROOT, rel), 'utf8');
        for (const m of src.matchAll(/^(?:export\s+)?(?:async\s+)?function\s+([A-Za-z_$][\w$]*)/gm)) declarados.add(m[1]);
        for (const m of src.matchAll(/^(?:const|let|var)\s+([A-Za-z_$][\w$]*)/gm)) declarados.add(m[1]);
        for (const m of src.matchAll(/window\.([A-Za-z_$][\w$]*)\s*=(?!=)/g)) expuestos.add(m[1]);
    }
    // Nombres que otro archivo NO puede ver por su nombre pelado.
    const invisibles = [...declarados].filter(n => !expuestos.has(n)
        // firebase-init.js declara su PROPIA checkAuthorization; no es esta.
        && n !== 'checkAuthorization');
    const modAbs = new Set(MODULES.map(f => path.resolve(ROOT, f)));
    const recorrer = (dir, out) => {
        for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
            if (e.name === 'node_modules' || e.name === '.git') continue;
            const p = path.join(dir, e.name);
            if (e.isDirectory()) recorrer(p, out); else if (/\.js$/.test(e.name)) out.push(p);
        }
        return out;
    };
    const fugas = [];
    for (const f of recorrer(path.join(ROOT, 'js'), [])) {
        if (modAbs.has(path.resolve(f))) continue;
        const rel = path.relative(ROOT, f).replace(/\\/g, '/');
        fs.readFileSync(f, 'utf8').split('\n').forEach((l, i) => {
            const code = l.trim();
            if (!code || code.startsWith('//') || code.startsWith('*')) return;
            // se ignora lo que vaya dentro de comillas (plantillas de HTML)
            const sinCadenas = code.replace(/(['"`])(?:\\.|(?!\1).)*\1/g, '""');
            for (const n of invisibles) {
                if (new RegExp('(?<![.\\w$])' + n.replace(/[$]/g, '\\$') + '\\b').test(sinCadenas))
                    fugas.push(rel + ':' + (i + 1) + '  [' + n + ']  ' + code.slice(0, 70));
            }
        });
    }
    ok('3c · ⚠️ ningun script clasico referencia por nombre pelado algo del ambito de modulo',
        fugas.length === 0, fugas);
}

console.log('\n────────────────────────────────────────────');
console.log('Resultado: ' + pass + '/' + (pass + fail) + (fail ? '  ❌ ' + fail + ' FALLOS' : '  ✅'));
process.exit(fail ? 1 : 0);

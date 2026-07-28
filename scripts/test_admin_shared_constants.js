// ─────────────────────────────────────────────────────────────────────────
// test_admin_shared_constants.js · Refactor de monolitos (auditoria 2026-07-22)
//
// NACE DE UN FALLO REAL EN PRODUCCION, encontrado el 2026-07-28 durante el
// inventario del monolito #5 (js/core/app-init.js).
//
// LA CLASE DE BUG — el espejo del fallo de v383:
//   Una declaracion `const X` de nivel superior en un script CLASICO no crea
//   una propiedad de window: crea un binding en el REGISTRO DECLARATIVO del
//   ambito global. Y ese registro se resuelve ANTES que el objeto global. O
//   sea: si app-init.js (el PRIMER script de index.html) declara `const X`, y
//   cualquier script posterior hace `window.X = ...`, toda lectura por nombre
//   PELADO en cualquier parte de la app sigue viendo la de app-init. Las dos
//   coexisten y `X === window.X` es false.
//
// EL DAÑO CONCRETO QUE ESTO CAUSABA (reproducido, no teorico):
//   app-init.js:4648 declaraba `const ROLE_META` con 7 roles y SIN clave
//   `icon`; js/shared/admin-shared.js:7 publica `window.ROLE_META` con 11
//   roles y con `icon`. js/admin/club/panel.js MEZCLA las dos formas en el
//   mismo archivo: usa window.ROLE_META en L553/605/741/833/872/2001 y el
//   nombre pelado en L772-773, L798-799, L890 y L1035. Resultado en pantalla
//   del panel Admin de Club:
//     · rol 'user'   ->  "👤 ⚽ Entrenador"  (emoji duplicado: la etiqueta de
//                        app-init ya lleva el emoji dentro y `.icon` no
//                        existe, asi que caia al fallback '👤')
//     · rol 'parent' ->  "👤 parent"  en vez de "👨‍👩‍👧 Padre / Madre / Tutor"
//                        (app-init NO tiene la clave 'parent')
//     · L890         ->  "Usuario" en vez del rol solicitado real
//     · L1044        ->  un literal "<span>undefined</span>" por cada usuario
//                        activo, porque meta.icon no existia
//
// POR QUE LAS GUARDAS NO LO VIERON: club/panel.js:10, individual/panel.js:37
// y superadmin.panel.js:28 comprueban `typeof window.ROLE_META === 'undefined'`
// / `window.SA_CSS`. window SI esta definido (lo pone admin-shared.js), asi
// que la guarda nunca salta, mientras las lecturas peladas siguen cogiendo la
// const. Misma familia de falso negativo que las trampas `===`/`typeof` ya
// documentadas en este refactor.
//
// LA CORRECCION: las constantes compartidas viven en js/shared/admin-shared.js
// como `window.*` y app-init.js no las declara. Al desaparecer la const, la
// lectura pelada cae al objeto global y todo el mundo ve la MISMA tabla.
//
// ⚠️ SA_CSS SE MOVIO VERBATIM, no se sustituyo: las 18 clases que usan
// club/panel.js e individual/panel.js existian en las DOS versiones, pero con
// valores distintos (.sa-modal era width:1060px en app-init y max-width:860px
// en admin-shared). Como la que se aplicaba de verdad era la de app-init, se
// conserva esa para que no cambie ni un pixel. La parte 4 lo fija.
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
const rd = rel => fs.readFileSync(path.join(ROOT, rel), 'utf8');

console.log('── Constantes compartidas de administracion ──\n');

// Sin comentarios: varias plantillas HTML contienen estos nombres como texto.
// ⚠️ Los saltos de linea de los bloques /* */ se CONSERVAN: si se colapsan, los
// numeros de linea que reporta el detector se desplazan y apuntan a otro sitio.
const strip = s => s.replace(/\/\*[\s\S]*?\*\//g, m => m.replace(/[^\n]/g, ''))
    .split('\n').map(l => l.replace(/(^|\s)\/\/.*$/, '$1')).join('\n');

// Orden real de carga de los scripts CLASICOS (los type="module" no comparten
// el registro declarativo global, no participan en este solapamiento).
const idxHtml = rd('index.html');
const ORDER = [...idxHtml.matchAll(/<script src="(js\/[^"?]+)/g)]
    .map(m => m[1]).filter(f => fs.existsSync(path.join(ROOT, f)));

// ───────────────────────── PARTE 1 · el detector ─────────────────────────
// Ningun script clasico puede declarar `const/let X` de nivel superior si otro
// script POSTERIOR asigna `window.X`: el primero gana en toda lectura pelada.

function topLevelLexicals(src) {
    const out = new Map();
    strip(src).split('\n').forEach((l, i) => {
        const m = l.match(/^(?:const|let)\s+([A-Za-z_$][\w$]*)\s*=(?!=)/);
        if (m && !out.has(m[1])) out.set(m[1], i + 1);
    });
    return out;
}
function windowAssigns(src) {
    const out = new Map();
    strip(src).split('\n').forEach((l, i) => {
        const m = l.match(/^\s*window\.([A-Za-z_$][\w$]*)\s*=(?!=)/);
        if (m && !out.has(m[1])) out.set(m[1], i + 1);
    });
    return out;
}

function detectarSolapamientos(files, leer) {
    const hits = [];
    files.forEach((f, i) => {
        const lex = topLevelLexicals(leer(f));
        if (!lex.size) return;
        files.slice(i + 1).forEach(g => {
            const win = windowAssigns(leer(g));
            for (const [name, line] of lex) {
                if (win.has(name)) hits.push(f + ':' + line + ' const ' + name + '  <-- pisa a  ' + g + ':' + win.get(name) + ' window.' + name);
            }
        });
    });
    return hits;
}

// 1a · AUTOTEST DEL DETECTOR contra el caso historico real. Si esto no salta,
// el detector se ha roto y un verde de 1b no significaria nada.
{
    const falso = {
        'a.js': 'const ROLE_META = { user: { label: "x" } };\n',
        'b.js': 'window.ROLE_META = { user: { label: "y", icon: "z" } };\n',
    };
    const h = detectarSolapamientos(['a.js', 'b.js'], f => falso[f]);
    ok('1a · el detector SI dispara sobre la reproduccion del caso historico', h.length === 1, h);
    // y no debe disparar al reves (window primero, const despues no existe en
    // la practica porque seria el mismo archivo, pero el orden importa)
    const h2 = detectarSolapamientos(['b.js', 'a.js'], f => falso[f]);
    ok('1b · el detector NO dispara si el window va primero (no hay solapamiento)', h2.length === 0, h2);
}

// EXCEPCIONES CONOCIDAS Y ANALIZADAS. Solo se tolera lo que este aqui: asi el
// barrido sigue cazando cualquier caso NUEVO.
//
//   staffConfig — `let` en app-init.js:128 vs `window.staffConfig` en
//   staff-and-comms.js:7. Analizado el 2026-07-28 y NO corregido a proposito.
//   Es el mismo mecanismo, pero HOY no rompe nada: staff-and-comms.js lee y
//   escribe SIEMPRE por nombre pelado (L17, L23-26, L38, L247-274), o sea
//   siempre sobre el `let` de app-init. Lo que crea su guarda de L6-8 es un
//   `window.staffConfig` FANTASMA que se queda vacio para siempre
//   (verificado: tras `staffConfig.coach1 = 'X'`, `window.staffConfig.coach1`
//   sigue siendo ''). Es una mina, no un fallo: en cuanto alguien escriba
//   `window.staffConfig.coach1` leera el objeto vacio. Corregirlo toca el
//   estado global mutable de §1 y merece su propio paso.
const EXCEPCIONES = new Set(['staffConfig']);

// 1c · el barrido real sobre todo el repo
{
    const todos = detectarSolapamientos(ORDER, f => rd(f));
    const hits = todos.filter(h => ![...EXCEPCIONES].some(n => h.includes(' const ' + n + ' ') || h.includes(' let ' + n + ' ')));
    ok('1c · ⚠️ ninguna `const` de nivel superior ensombrece un `window.X` posterior', hits.length === 0, hits);
    // que la excepcion siga existiendo: si alguien la arregla, hay que sacarla
    // de la lista en vez de dejar un permiso muerto abierto.
    const vivas = [...EXCEPCIONES].filter(n => todos.some(h => h.includes(' const ' + n + ' ') || h.includes(' let ' + n + ' ')));
    ok('1e · las excepciones toleradas siguen siendo reales (si no, retirarlas de la lista)',
        vivas.length === EXCEPCIONES.size, { esperadas: [...EXCEPCIONES], vivas });
}

// 1d · app-init.js no puede volver a declarar ninguna de las cuatro
{
    const lex = topLevelLexicals(rd('js/core/app-init.js'));
    const prohibidas = ['ROLE_META', 'SA_CSS', 'SA_CONFIG', 'PLAN_META', 'STATUS_META']
        .filter(n => lex.has(n));
    ok('1d · app-init.js ya no declara ROLE_META/SA_CSS/SA_CONFIG/PLAN_META/STATUS_META',
        prohibidas.length === 0, prohibidas);
}

// ──────────────── PARTE 2 · las constantes viven en admin-shared ────────────
const SHARED = 'js/shared/admin-shared.js';
{
    const win = windowAssigns(rd(SHARED));
    ['ROLE_META', 'SA_CSS', 'SA_CONFIG', 'PLAN_META', 'STATUS_META'].forEach((n, k) => {
        ok('2' + 'abcde'[k] + ' · admin-shared.js publica window.' + n, win.has(n));
    });
    // admin-shared debe cargarse ANTES que todo panel de administracion
    const posShared = idxHtml.indexOf(SHARED);
    const consumidores = ['js/admin/club/panel.js', 'js/admin/individual/panel.js', 'js/admin/billing/payments.js'];
    const malColocados = consumidores.filter(c => idxHtml.indexOf(c) < posShared);
    ok('2f · admin-shared.js se carga antes que club/individual/billing', posShared > 0 && malColocados.length === 0, malColocados);
}

// Sandbox con window === global, como en un navegador de verdad.
function cargarShared() {
    const sb = {};
    vm.createContext(sb);
    sb.window = sb;
    vm.runInContext(rd(SHARED), sb);
    return sb;
}

// ─────────── PARTE 3 · las lecturas PELADAS de club/panel.js ya aciertan ───────────
// Son las expresiones reales de las lineas L772-773, L890 y L1035+1044.
{
    const sb = cargarShared();
    const etiqueta = r => vm.runInContext(
        '(function(r){ var l = ROLE_META[r]?.label || r || "Usuario"; var i = ROLE_META[r]?.icon || "\\u{1F464}"; return i + " " + l; })(' + JSON.stringify(r) + ')', sb);

    ok('3a · rol "user" no duplica emoji', etiqueta('user') === '⚽ Entrenador', etiqueta('user'));
    ok('3b · rol "parent" se traduce (no sale el codigo crudo)', etiqueta('parent') === '👨‍👩‍👧 Padre / Madre / Tutor', etiqueta('parent'));
    ok('3c · rol "coordinator" no duplica emoji', etiqueta('coordinator') === '🎯 Coordinador', etiqueta('coordinator'));
    ok('3d · rol "director" muestra el nombre completo', etiqueta('director') === '📋 Director Deportivo', etiqueta('director'));
    ok('3e · rol "parent_individual" se traduce', etiqueta('parent_individual') === '👨‍👩‍👧 Padre/Madre/Tutor Individual', etiqueta('parent_individual'));

    // L890: ROLE_META[u.requestedRole || 'user']?.label || 'Usuario'
    const solicitado = vm.runInContext(
        '(function(r){ return ROLE_META[r || "user"]?.label || "Usuario"; })("parent")', sb);
    ok('3f · L890 no degrada una solicitud de padre a "Usuario"', solicitado === 'Padre / Madre / Tutor', solicitado);

    // L1035 + L1044: const meta = ROLE_META[u.role] || {...}; '<span>'+meta.icon+'</span>'
    const sinIcono = ['superadmin', 'club_admin', 'director', 'coordinator', 'user', 'parent', 'individual']
        .filter(r => vm.runInContext('(ROLE_META[' + JSON.stringify(r) + '] || {}).icon', sb) === undefined);
    ok('3g · ⚠️ ningun rol pinta <span>undefined</span> (todos tienen .icon)', sinIcono.length === 0, sinIcono);

    // toda entrada debe traer las tres claves que consumen los paneles
    const incompletas = vm.runInContext(
        'Object.entries(ROLE_META).filter(([k,v]) => !v || !v.label || !v.icon || !v.color).map(([k])=>k)', sb);
    ok('3h · toda entrada de ROLE_META trae label + icon + color', incompletas.length === 0, incompletas);
}

// ─────────── PARTE 4 · SA_CSS se movio VERBATIM (cero cambio visual) ───────────
{
    const sb = cargarShared();
    const css = vm.runInContext('window.SA_CSS', sb);
    ok('4a · window.SA_CSS es una cadena no vacia', typeof css === 'string' && css.length > 500);

    // las clases que realmente usan los paneles que leen SA_CSS por nombre pelado
    const usadas = new Set();
    ['js/admin/club/panel.js', 'js/admin/individual/panel.js'].forEach(f => {
        [...rd(f).matchAll(/class="([^"]*)"/g)].forEach(m =>
            m[1].split(/\s+/).forEach(c => { if (/^sa-/.test(c)) usadas.add('.' + c); }));
    });
    const definidas = new Set(css.match(/\.sa-[a-z0-9-]+/g) || []);
    const faltan = [...usadas].filter(c => !definidas.has(c));
    ok('4b · SA_CSS define las ' + usadas.size + ' clases .sa-* que usan los paneles', faltan.length === 0, faltan);

    // la firma de la version que SE APLICABA de verdad hasta hoy (la de
    // app-init). Si alguien la sustituye por la antigua de admin-shared
    // (max-width:860px) los paneles encogen sin que nadie lo note.
    ok('4c · ⚠️ .sa-modal conserva el ancho de la version vigente (1060px)', /\.sa-modal\{[^}]*width:1060px/.test(css),
        (css.match(/\.sa-modal\{[^}]*\}/) || [''])[0].slice(0, 90));
    ok('4d · SA_CSS conserva las clases exclusivas del panel legacy', ['.sa-tab', '.sa-table', '.sa-flag', '.sa-notif', '.sa-slotbar'].every(c => definidas.has(c)));
}

// ─────────── PARTE 5 · SA_CONFIG / PLAN_META / STATUS_META siguen alcanzables ───────────
// js/admin/billing/payments.js las lee por nombre PELADO. Al no existir ya la
// const, la lectura cae al objeto global: hay que probar que resuelve.
{
    const sb = cargarShared();
    ['SA_CONFIG', 'PLAN_META', 'STATUS_META'].forEach((n, k) => {
        const v = vm.runInContext('typeof ' + n + ' !== "undefined" ? ' + n + ' : null', sb);
        ok('5' + 'abc'[k] + ' · ' + n + ' resuelve por nombre pelado tras cargar admin-shared', v && typeof v === 'object', v);
    });
    // `?? null` para que la ausencia de la constante sea un FAIL legible y no
    // un ReferenceError que aborte el resto del archivo.
    const ev = expr => { try { return vm.runInContext(expr, sb); } catch (_) { return null; } };
    const claves = ev('Object.keys(SA_CONFIG).sort().join(",")');
    ok('5d · SA_CONFIG conserva sus 6 campos', claves === 'appUrl,bizum,email,iban,nombre,whatsapp', claves);
    ok('5e · PLAN_META conserva los 8 planes', ev('Object.keys(PLAN_META).length') === 8);
    ok('5f · STATUS_META conserva los 4 estados', ev('Object.keys(STATUS_META).length') === 4);

    // payments.js debe seguir encontrando lo que lee
    const pay = strip(rd('js/admin/billing/payments.js'));
    ok('5g · payments.js sigue leyendo SA_CONFIG', /\bSA_CONFIG\./.test(pay));
    ok('5h · payments.js sigue leyendo PLAN_META', /\bPLAN_META\b/.test(pay));
}

console.log('\n────────────────────────────────────────────');
console.log('Resultado: ' + pass + '/' + (pass + fail) + (fail ? '  ❌ ' + fail + ' FALLOS' : '  ✅'));
process.exit(fail ? 1 : 0);

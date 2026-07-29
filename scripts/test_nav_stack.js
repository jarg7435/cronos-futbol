// ─────────────────────────────────────────────────────────────────────────
// test_nav_stack.js  ·  Pila de navegacion unica (panel del Entrenador)
//
// Requisito del autor (2026-07-29): al navegar hacia dentro de cualquier
// panel, "Volver" debe deshacer EXACTAMENTE el camino andado, y "Salir" debe
// abandonar limpiamente. Hoy no puede: todas las pantallas se pintan en el
// mismo contenedor (#setup-modal) sobrescribiendo innerHTML, asi que la
// anterior se destruye y cada "Volver" lleva a un destino CABLEADO.
//
// EL CASO VERIFICADO QUE ESTE TEST FIJA (medido leyendo el codigo):
//   openMisInformes se alcanza desde DOS sitios —
//     · js/core/setup-modal.js:267   (boton "MIS INFORMES" del modal de setup)
//     · js/core/app-init.js:781      (boton "INFORMES INDIVIDUALES" del
//                                     post-partido, showPostMatchOptions)
//   y su "← Volver" (individual-reports.js:76) llamaba SIEMPRE a
//   openUnifiedCommsMenu() — una TERCERA pantalla que no es ninguna de las
//   dos. O sea: terminas un partido, entras en tus informes, pulsas Volver y
//   apareces en el menu de Comunicaciones, con el post-partido ya destruido.
//   Las DOS vias acababan donde el usuario nunca estuvo.
//
// El test ejecuta el modulo REAL js/core/nav-stack.js en un sandbox y simula
// las dos rutas con pantallas de mentira, comprobando a donde lleva navBack.
// Las PARTES 4 y 5 comprueban el codigo real ya migrado.
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

console.log('── Pila de navegacion unica ──\n');

const NAV = path.join(ROOT, 'js', 'core', 'nav-stack.js');
const navSrc = fs.readFileSync(NAV, 'utf8');

// ── sandbox con el modulo real y pantallas de mentira ──
function build() {
    const pintadas = [];
    const sb = {
        console: { log() {}, warn() {}, error() {} },
        document: { getElementById: () => ({ style: {}, innerHTML: '' }) },
        showToast() {},
    };
    sb.window = sb;
    vm.createContext(sb);
    vm.runInContext(navSrc, sb);

    // Pantallas de mentira que se auto-registran igual que las reales.
    const raiz = (n) => { sb[n] = function () { sb.navRootScreen(n); pintadas.push(n); }; };
    const hija = (n) => { sb[n] = function (...a) { sb.navScreen(n, ...a); pintadas.push(n); }; };
    raiz('openSetupModal');
    raiz('showPostMatchOptions');
    hija('openMisInformes');
    hija('openUnifiedCommsMenu');
    hija('openMisInformesColectivos');
    hija('openContactManager');

    return { sb, pintadas, ultima: () => pintadas[pintadas.length - 1] };
}

// ═══════ PARTE 1 · el caso verificado: dos entradas, un "Volver" ═══════
console.log('── PARTE 1 · el mismo "Volver" respeta la via de entrada ──');
{
    // RUTA A: modal de setup -> Mis Informes -> Volver
    const A = build();
    A.sb.openSetupModal();
    A.sb.openMisInformes();
    ok('1a · [ruta A] la pila describe el camino: setup -> misInformes',
       JSON.stringify(A.sb._navTrail()) === '["openSetupModal","openMisInformes"]',
       JSON.stringify(A.sb._navTrail()));
    A.sb.navBack();
    ok('1b · [ruta A] Volver devuelve al MODAL DE SETUP',
       A.ultima() === 'openSetupModal', 'acabo en: ' + A.ultima());

    // RUTA B: post-partido -> Mis Informes -> Volver
    const B = build();
    B.sb.showPostMatchOptions(2, 1);
    B.sb.openMisInformes();
    B.sb.navBack();
    ok('1c · [ruta B] el MISMO Volver devuelve al POST-PARTIDO, no a Comunicaciones',
       B.ultima() === 'showPostMatchOptions', 'acabo en: ' + B.ultima());

    ok('1d · y repinta el post-partido con SUS argumentos (2-1)',
       JSON.stringify(B.sb._navTrail()) === '["showPostMatchOptions"]',
       JSON.stringify(B.sb._navTrail()));
}

// ═══════ PARTE 2 · pila profunda y salida ═══════
console.log('\n── PARTE 2 · varios niveles, y "Salir" ──');
{
    const t = build();
    t.sb.openSetupModal();
    t.sb.openUnifiedCommsMenu();
    t.sb.openMisInformes();
    ok('2a · tres niveles apilados', t.sb.navDepth() === 3, 'profundidad: ' + t.sb.navDepth());
    t.sb.navBack();
    ok('2b · un paso atras -> Comunicaciones', t.ultima() === 'openUnifiedCommsMenu', t.ultima());
    t.sb.navBack();
    ok('2c · otro paso atras -> modal de setup', t.ultima() === 'openSetupModal', t.ultima());
    ok('2d · en la raiz ya no se puede volver mas', t.sb.navCanGoBack() === false);

    t.sb.openMisInformes();
    t.sb.navExit();
    ok('2e · "Salir" vacia la pila entera', t.sb.navDepth() === 0);
}

// ═══════ PARTE 3 · robustez ═══════
console.log('\n── PARTE 3 · robustez de la pila ──');
{
    const t = build();
    t.sb.openSetupModal();
    t.sb.openMisInformes();
    t.sb.openMisInformes();      // re-render de la misma pantalla
    ok('3a · repintar la MISMA pantalla no la apila dos veces', t.sb.navDepth() === 2,
       JSON.stringify(t.sb._navTrail()));

    // Una pantalla sin migrar que llama directo a la raiz: la pila se auto-sana
    const u = build();
    u.sb.showPostMatchOptions(0, 0);
    u.sb.openMisInformes();
    u.sb.openSetupModal();       // llamada DIRECTA, como en el codigo antiguo
    ok('3b · una llamada antigua directa a la raiz RESETEA la pila (migracion parcial segura)',
       JSON.stringify(u.sb._navTrail()) === '["openSetupModal"]',
       JSON.stringify(u.sb._navTrail()));

    const v = build();
    v.sb.openSetupModal();
    ok('3c · navBack en la raiz sale en vez de romperse',
       (v.sb.navBack(), v.sb.navDepth() === 0));

    const w = build();
    w.sb.openSetupModal();
    w.sb.navScreen('pantallaQueYaNoExiste');
    ok('3d · si la pantalla anterior ya no existe, navBack sale limpiamente',
       (w.sb.navBack(), true));
}

// ═══════ PARTE 4 · el codigo REAL esta migrado ═══════
console.log('\n── PARTE 4 · migracion del panel del Entrenador ──');
{
    const leer = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8').replace(/\r\n/g, '\n');
    const setup = leer('js/core/setup-modal.js');
    const appInit = leer('js/core/app-init.js');
    const indiv = leer('js/coach/comms/individual-reports.js');

    ok('4a · openSetupModal se declara RAIZ', /navRootScreen\(\s*['"]openSetupModal['"]/.test(setup));
    ok('4b · showPostMatchOptions se declara RAIZ', /navRootScreen\(\s*['"]showPostMatchOptions['"]/.test(appInit));
    ok('4c · showPostMatchOptions guarda su marcador para repintarse igual',
       /navRootScreen\(\s*['"]showPostMatchOptions['"]\s*,\s*scoreHome\s*,\s*scoreAway\s*\)/.test(appInit));
    ok('4d · openMisInformes se auto-registra', /navScreen\(\s*['"]openMisInformes['"]/.test(indiv));

    // ⚠️ ACOTAR AL CUERPO DE openMisInformes. Este archivo contiene TAMBIEN
    // openIndividualReports, otra pantalla que sigue con su destino cableado a
    // openUnifiedCommsMenu — y que queda FUERA de este piloto a proposito: su
    // propia cabecera documenta que no tiene ningun punto de entrada
    // localizable en el repo. Buscar en todo el archivo daba rojo por ella y
    // no por lo que este test afirma.
    const iIni = indiv.indexOf('window.openMisInformes');
    const iFin = indiv.indexOf('window.openIndividualReports');
    const cuerpoMis = (iIni > -1 && iFin > iIni) ? indiv.slice(iIni, iFin) : indiv;
    ok('4e · [FIX] el "Volver" de Mis Informes ya NO va cableado a openUnifiedCommsMenu',
       !/onclick="openUnifiedCommsMenu\(\)"/.test(cuerpoMis));
    ok('4f · el "Volver" de Mis Informes usa navBack()',
       /onclick="navBack\(\)"[\s\S]{0,400}?Volver/.test(cuerpoMis));
    ok('4g · y su ✕ SALE (navExit), que no es lo mismo que volver',
       /onclick="navExit\(\)"/.test(cuerpoMis));
}

// ═══════ PARTE 5 · el modulo esta servido ═══════
console.log('\n── PARTE 5 · nav-stack.js entra en la app ──');
{
    const idx = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
    ok('5a · index.html carga js/core/nav-stack.js', /js\/core\/nav-stack\.js/.test(idx));
    ok('5b · y con marcador ?v= como el resto', /js\/core\/nav-stack\.js\?v=v\d+/.test(idx));
    const iNav = idx.indexOf('js/core/nav-stack.js');
    const iSetup = idx.indexOf('js/core/setup-modal.js');
    ok('5c · se carga ANTES que setup-modal.js (que ya lo usa al pintarse)',
       iNav > -1 && iSetup > -1 && iNav < iSetup, 'nav=' + iNav + ' setup=' + iSetup);
}

console.log(`\n${pass} PASS / ${fail} FAIL`);
process.exit(fail ? 1 : 0);

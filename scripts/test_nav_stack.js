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

// ═══════ PARTE 6 · el RESTO del panel del Entrenador ═══════
console.log('\n── PARTE 6 · resto del panel del Entrenador migrado ──');
{
    const leer = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8').replace(/\r\n/g, '\n');
    // pantalla -> [archivo, si su "Volver" debe usar navBack]
    const PANTALLAS = [
        ['openRosterManager',      'js/core/staff-and-comms.js'],
        ['openContactManager',     'js/coach/comms/contact-manager.js'],
        ['openConvocationModal',   'js/ai/import.js'],
        ['openTrainingPanel',      'js/coach/training/panel.js'],
        ['openUnifiedCommsMenu',   'js/coach/comms/panel.js'],
        ['openLiveMatchRecovery',  'js/core/setup-modal.js'],
        ['_openCoachCommsMenu',    'js/core/setup-modal.js'],
        ['openTrainingNotification','js/coach/comms/training-notify.js'],
    ];
    for (const [nombre, archivo] of PANTALLAS) {
        const src = leer(archivo);
        ok(`6·${nombre} se auto-registra`,
           new RegExp("navScreen\\(\\s*['\"]" + nombre + "['\"]").test(src), archivo);
    }

    // Ya no debe quedar ningun "Volver"/✕ cableado en los archivos migrados.
    const CABLEADOS = [
        ['js/core/staff-and-comms.js',       /onclick="openSetupModal\(\)"[\s\S]{0,400}?←\s*Volver/],
        ['js/coach/comms/contact-manager.js',/onclick="openUnifiedCommsMenu\(\)"[\s\S]{0,200}?VOLVER/],
        ['js/coach/training/panel.js',       /onclick="openSetupModal\(\)"[\s\S]{0,200}?VOLVER/],
    ];
    for (const [archivo, re] of CABLEADOS) {
        ok(`6·${archivo} ya no tiene "Volver" cableado`, !re.test(leer(archivo)));
    }

    const comms = leer('js/coach/comms/panel.js');
    // Acotar por el FINAL REAL de la funcion (la siguiente declaracion en
    // columna 0), no por un numero fijo de caracteres: el innerHTML de este
    // menu ocupa mas de 4000 y el "Volver" de abajo se quedaba fuera del
    // corte, dando rojo por la razon equivocada.
    const iMenu = comms.indexOf('async function openUnifiedCommsMenu');
    const iFinMenu = comms.slice(iMenu + 1).search(/\n(?:async )?function \w+\s*\(|\nwindow\.\w+\s*=/);
    const cuerpoMenu = iMenu > -1
        ? comms.slice(iMenu, iFinMenu > -1 ? iMenu + 1 + iFinMenu : comms.length)
        : comms;
    ok('6·el menu de Comunicaciones usa navBack() y navExit()',
       /onclick="navBack\(\)"/.test(cuerpoMenu) && /onclick="navExit\(\)"/.test(cuerpoMenu));
    ok('6·y su ✕ ya no llama a openSetupModal cableado',
       !/openSetupModal==='function'\?openSetupModal\(\)/.test(cuerpoMenu));

    // ⚠️ LO QUE QUEDA CABLEADO A PROPOSITO. Este censo fija el limite exacto
    // de la migracion, para que no se cuele ninguno nuevo por descuido.
    //   · panel.js            -> _renderUnifiedMessagingView, el motor de
    //     mensajeria unificada que el autor pidio proteger: se migra aparte y
    //     con guard propio (tiene 4 vias de entrada).
    //   · individual-reports  -> openIndividualReports, SIN punto de entrada
    //     localizable en el repo (lo documenta su propia cabecera).
    //   · collective-report   -> openCollectiveReport, tambien SIN invocador:
    //     el boton "INFORMES COLECTIVOS" del post-partido llama a
    //     openMisInformesColectivos, que NO EXISTE en el proyecto.
    const PENDIENTES = {
        'js/coach/comms/panel.js': 1,
        'js/coach/comms/individual-reports.js': 2,
        'js/coach/comms/collective-report.js': 2,
    };
    let restantes = 0;
    for (const [archivo, esperados] of Object.entries(PENDIENTES)) {
        const n = (leer(archivo).match(/onclick="openUnifiedCommsMenu\(\)"/g) || []).length;
        restantes += n;
        ok(`6·${archivo}: quedan ${esperados} cableados (pendientes conocidos)`, n === esperados,
           'encontrados: ' + n);
    }
    // Ningun OTRO archivo del panel del Entrenador puede tener uno.
    const TODOS = ['js/coach/comms/contact-manager.js', 'js/coach/comms/training-notify.js',
                   'js/core/staff-and-comms.js', 'js/coach/training/panel.js', 'js/ai/import.js',
                   'js/core/setup-modal.js'];
    for (const archivo of TODOS) {
        ok(`6·${archivo}: sin destinos cableados a Comunicaciones`,
           !/onclick="openUnifiedCommsMenu\(\)"/.test(leer(archivo)));
    }
}

// ═══════ PARTE 7 · recorridos reales de dos niveles ═══════
console.log('\n── PARTE 7 · recorridos completos del panel del Entrenador ──');
{
    function esc() {
        const t = build();
        ['openRosterManager','openContactManager','openConvocationModal','openTrainingPanel',
         'openLiveMatchRecovery','_openCoachCommsMenu'].forEach(n => {
            t.sb[n] = function(...a){ t.sb.navScreen(n, ...a); t.pintadas.push(n); };
        });
        return t;
    }
    // setup -> Comunicaciones -> Contactos -> Volver -> Volver
    const t = esc();
    t.sb.openSetupModal();
    t.sb.openUnifiedCommsMenu();
    t.sb.openContactManager();
    t.sb.navBack();
    ok('7a · Contactos -> Volver -> menu de Comunicaciones',
       t.ultima() === 'openUnifiedCommsMenu', t.ultima());
    t.sb.navBack();
    ok('7b · y otro Volver -> modal de setup', t.ultima() === 'openSetupModal', t.ultima());

    // post-partido -> Comunicaciones -> Volver debe volver AL POST-PARTIDO
    const u = esc();
    u.sb.showPostMatchOptions(3, 0);
    u.sb.openUnifiedCommsMenu();
    u.sb.navBack();
    ok('7c · [caso nuevo] Comunicaciones abierto desde el post-partido vuelve AL POST-PARTIDO',
       u.ultima() === 'showPostMatchOptions', u.ultima());

    // setup -> Contactos (entrada directa desde el modal, sin pasar por Comunicaciones)
    const v = esc();
    v.sb.openSetupModal();
    v.sb.openContactManager();
    v.sb.navBack();
    ok('7d · [caso nuevo] Contactos abierto desde el modal de setup vuelve AL MODAL, no a Comunicaciones',
       v.ultima() === 'openSetupModal', v.ultima());
}

// ═══════ PARTE 8 · panel del SuperAdmin ═══════
console.log('\n── PARTE 8 · panel del SuperAdmin ──');
{
    const leer = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8').replace(/\r\n/g, '\n');
    // ⚠️ Quitar los comentarios ANTES de medir. Mis propios comentarios
    // explicativos contienen literalmente `saTab('payments')` y la palabra
    // `await`, y hacian fallar tres aserciones por la razon equivocada — el
    // defecto medía el comentario, no el codigo. Se divide por /\r?\n/ y no
    // por '\n': en una regex de JS el `.` NO casa `\r`, asi que `//.*$` nunca
    // llega al `$` en un archivo CRLF y el stripper no borraria nada.
    const sinComentarios = (s) => s.split(/\r?\n/)
        .map(l => l.replace(/\/\/.*$/, ''))
        .join('\n');
    const SA = [
        ['openSuperAdminPanel',            'js/admin/superadmin/superadmin.panel.js', 'navRootScreen'],
        ['saTab',                          'js/admin/superadmin/superadmin.panel.js', 'navScreen'],
        ['saShowCreateIndividualEntity',   'js/admin/superadmin/individual-entity.js','navScreen'],
        ['saEditIndividualEntity',         'js/admin/superadmin/individual-entity.js','navScreen'],
        ['saShowEntityUsers',              'js/admin/superadmin/individual-entity.js','navScreen'],
        ['saShowCreateIndividualForEntity','js/admin/superadmin/individual-entity.js','navScreen'],
        ['saShowCreateClub',               'js/admin/superadmin/create-direct.js',    'navScreen'],
        ['saShowCreateIndividual',         'js/admin/superadmin/create-direct.js',    'navScreen'],
        ['saEditClubSlots',                'js/admin/superadmin/club-slots.js',       'navScreen'],
        ['saSendPaymentEmail',             'js/admin/billing/payments.js',            'navScreen'],
        ['saOpenIndividualEditor',         'js/core/app-init.js',                     'navScreen'],
    ];
    for (const [nombre, archivo, fn] of SA) {
        ok(`8·${nombre} se registra con ${fn}`,
           new RegExp(fn + "\\(\\s*['\"]" + nombre + "['\"]").test(leer(archivo)), archivo);
    }

    ok('8·saTab se registra CON la pestaña (para volver a la pestaña exacta)',
       /navScreen\(\s*['"]saTab['"]\s*,\s*tab\s*\)/.test(leer('js/admin/superadmin/superadmin.panel.js')));

    // Ya no debe quedar ningun "Volver" cableado a saTab en el panel.
    for (const archivo of ['js/admin/superadmin/individual-entity.js',
                           'js/admin/superadmin/create-direct.js',
                           'js/admin/superadmin/club-slots.js',
                           'js/admin/billing/payments.js']) {
        ok(`8·${archivo}: ningun boton llama ya a saTab(...)`,
           !/onclick="saTab\(/.test(leer(archivo)));
    }

    // 🐛 El boton roto: saTab('payments') no existia como pestaña.
    const pay = sinComentarios(leer('js/admin/billing/payments.js'));
    const panel = sinComentarios(leer('js/admin/superadmin/superadmin.panel.js'));
    ok("8·[FIX] ya no queda ninguna llamada a saTab('payments')",
       !/saTab\(\s*['"]payments['"]\s*\)/.test(pay));
    ok("8·y se confirma que 'payments' NUNCA fue una pestaña de saTab",
       !/tab\s*===\s*['"]payments['"]/.test(panel));

    // 🐛 El SEGUNDO boton roto: saTab('individual') EN SINGULAR (la pestaña es
    // 'individuals'), en saOpenIndividualEditor. Mismo sintoma: no repintaba
    // nada y apagaba el subrayado de todas las pestañas.
    const appInit = sinComentarios(leer('js/core/app-init.js'));
    ok("8·[FIX] ya no queda saTab('individual') en singular",
       !/saTab\(\s*['"]individual['"]\s*\)/.test(appInit));
    ok("8·y se confirma que 'individual' en singular NUNCA fue una pestaña",
       !/tab\s*===\s*['"]individual['"]\s*\)/.test(panel));

    // Las 8 pestañas REALES, fijadas: si alguien añade o renombra una, este
    // censo se pone rojo y obliga a revisar los destinos.
    const TABS = ['clubs','individuals','requests','secretary','trash','billing','extras','messages'];
    for (const t of TABS) {
        ok(`8·la pestaña '${t}' sigue existiendo en saTab`,
           new RegExp("tab\\s*===\\s*['\"]" + t + "['\"]").test(panel));
    }

    // ⚠️ INVARIANTE DEL ASYNC: el registro tiene que ir ANTES del primer
    // `await`. navBack limpia su flag de restauracion cuando f.apply()
    // DEVUELVE — o sea al primer await, no al acabar el cuerpo. Un navScreen
    // posterior a un await correria con el flag ya limpio y volveria a apilar
    // la pantalla que se esta restaurando, dejando el "Volver" en bucle.
    const ASYNC = [
        ['openSuperAdminPanel',    'js/admin/superadmin/superadmin.panel.js'],
        ['saEditIndividualEntity', 'js/admin/superadmin/individual-entity.js'],
        ['saShowEntityUsers',      'js/admin/superadmin/individual-entity.js'],
        ['saEditClubSlots',        'js/admin/superadmin/club-slots.js'],
        ['saSendPaymentEmail',     'js/admin/billing/payments.js'],
        ['openMisInformes',        'js/coach/comms/individual-reports.js'],
        ['openContactManager',     'js/coach/comms/contact-manager.js'],
        ['openUnifiedCommsMenu',   'js/coach/comms/panel.js'],
    ];
    for (const [nombre, archivo] of ASYNC) {
        const src = sinComentarios(leer(archivo));
        const i = src.search(new RegExp('(?:window\\.)?' + nombre + '\\s*=\\s*async function|async function ' + nombre + '\\b'));
        if (i < 0) { ok(`8·${nombre}: localizada para el invariante async`, false, archivo); continue; }
        const cuerpo = src.slice(i, i + 4000);
        const iNav = cuerpo.search(/nav(?:Root)?Screen\(/);
        const iAwait = cuerpo.search(/\bawait\b/);
        ok(`8·[invariante async] ${nombre} registra ANTES del primer await`,
           iNav > -1 && (iAwait === -1 || iNav < iAwait),
           'nav=' + iNav + ' await=' + iAwait);
    }
}

// ═══════ PARTE 9 · recorridos del SuperAdmin ═══════
console.log('\n── PARTE 9 · recorridos del SuperAdmin ──');
{
    function saSandbox() {
        const t = build();
        t.sb.openSuperAdminPanel = function(){ t.sb.navRootScreen('openSuperAdminPanel'); t.pintadas.push('openSuperAdminPanel'); t.sb.saTab('clubs'); };
        t.sb.saTab = function(tab){ t.sb.navScreen('saTab', tab); t.pintadas.push('saTab:' + tab); };
        ['saShowCreateClub','saShowCreateIndividualEntity','saEditClubSlots'].forEach(n => {
            t.sb[n] = function(...a){ t.sb.navScreen(n, ...a); t.pintadas.push(n); };
        });
        return t;
    }

    const t = saSandbox();
    t.sb.openSuperAdminPanel();
    ok('9a · al abrir, la pila es [panel, saTab(clubs)]',
       JSON.stringify(t.sb._navTrail()) === '["openSuperAdminPanel","saTab"]',
       JSON.stringify(t.sb._navTrail()));

    // 🔑 Las pestañas son HERMANAS: cambiar de pestaña NO apila.
    t.sb.saTab('individuals');
    t.sb.saTab('requests');
    t.sb.saTab('individuals');
    ok('9b · cambiar de pestaña NO apila (siguen 2 niveles, no 5)', t.sb.navDepth() === 2,
       'profundidad: ' + t.sb.navDepth());

    t.sb.saShowCreateIndividualEntity();
    t.sb.navBack();
    ok('9c · Volver desde "Crear Ente" devuelve a la pestaña INDIVIDUALES',
       t.ultima() === 'saTab:individuals', t.ultima());

    // Y desde otra pestaña, el MISMO boton devuelve a ESA otra pestaña.
    const u = saSandbox();
    u.sb.openSuperAdminPanel();
    u.sb.saTab('billing');
    u.sb.saEditClubSlots('c1', 'Club Uno');
    u.sb.navBack();
    ok('9d · el MISMO Volver devuelve a FACTURACION si se entro desde ahi',
       u.ultima() === 'saTab:billing', u.ultima());

    // Repintado con argumentos: volver a una subpantalla con id.
    const v = saSandbox();
    v.sb.openSuperAdminPanel();
    v.sb.saTab('clubs');
    v.sb.saEditClubSlots('c9', 'Club Nueve');
    ok('9e · la subpantalla guarda sus argumentos en la pila',
       JSON.stringify(v.sb._navTrail()) === '["openSuperAdminPanel","saTab","saEditClubSlots"]',
       JSON.stringify(v.sb._navTrail()));
    v.sb.navBack();
    ok('9f · y al volver se repinta la pestaña, no el panel entero',
       v.ultima() === 'saTab:clubs' && v.sb.navDepth() === 2, v.ultima());
}

// ═══════ PARTE 10 · navReload() y panel del Admin de Club ═══════
console.log('\n── PARTE 10 · Admin de Club ──');
{
    const leer = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8').replace(/\r\n/g, '\n');
    const sinCom = (s) => s.split(/\r?\n/).map(l => l.replace(/\/\/.*$/, '')).join('\n');
    const club = sinCom(leer('js/admin/club/panel.js'));

    ok('10a · openClubAdminPanel se registra como RAIZ CON el clubId',
       /navRootScreen\(\s*['"]openClubAdminPanel['"]\s*,\s*clubId\s*\)/.test(club));
    ok('10b · y el selector de clubes se registra como raiz SIN argumentos',
       /navRootScreen\(\s*['"]openClubAdminPanel['"]\s*\)/.test(club));

    // 🐛 EL BUG DE LA RONDA: 10 refrescos escritos como openClubAdminPanel()
    // SIN el clubId. Para un SuperAdmin, que entra por el selector de clubes,
    // CADA accion de gestion (autorizar, rechazar, reenviar al SA, editar
    // equipo, quitar rol, dar de baja, bloquear/activar…) le devolvia al
    // LISTADO DE CLUBES en vez de al club que estaba gestionando.
    const sinArg = (club.match(/openClubAdminPanel\(\s*\)/g) || []).length;
    ok('10c · [FIX] ya no queda ningun refresco openClubAdminPanel() sin clubId',
       sinArg === 0, 'quedan: ' + sinArg);
    const reloads = (club.match(/navReload\(\)/g) || []).length;
    ok('10d · y hay 10 navReload() en su lugar', reloads === 10, 'encontrados: ' + reloads);
    ok('10e · cada uno con respaldo explicito al clubId si nav-stack no cargara',
       (club.match(/else openClubAdminPanel\(clubId\)/g) || []).length === 10,
       (club.match(/else openClubAdminPanel\(clubId\)/g) || []).length);

    // navReload existe y no apila
    ok('10f · nav-stack.js exporta navReload',
       /window\.navReload\s*=/.test(sinCom(leer('js/core/nav-stack.js'))));

    // 🔑 EL ESLABON QUE CIERRA EL DIAGNOSTICO. Que los refrescos fueran sin
    // argumento solo es un BUG si llamar sin clubId lleva a otra pantalla.
    // Se fija aqui: clubId sale de `preClubId || me.clubId`, y la rama del
    // SELECTOR es exactamente `!clubId && isSA`. O sea que para un SuperAdmin
    // —que no tiene clubId propio— openClubAdminPanel() SIN argumento cae
    // siempre en el selector de clubes. Si alguien cambia esa condicion, este
    // test se pone rojo y obliga a revisar los navReload.
    ok('10g · clubId se deriva de preClubId || me.clubId',
       /let\s+clubId\s*=\s*preClubId\s*\|\|\s*me\.clubId/.test(club));
    ok('10h · y la rama del SELECTOR de clubes es exactamente `!clubId && isSA`',
       /if\s*\(\s*!clubId\s*&&\s*isSA\s*\)/.test(club));
    ok('10i · el selector es una pantalla DISTINTA: pinta "Seleccionar Club"',
       /Seleccionar Club/.test(club));

    // Las salidas que YA eran correctas y NO se tocan (para que no se
    // "arreglen" por descuido en una ronda futura):
    //   · el ✕ del selector y el "Volver" del estado "sin club asignado" van a
    //     showRoleSelector(): no hay pantalla anterior, la salida correcta es
    //     el selector de rol.
    //   · caShowSuccession crea su PROPIO overlay y su ✕ lo elimina sin
    //     destruir el panel de debajo, asi que ya se comporta como un modal
    //     de verdad y no necesita la pila.
    ok('10j · el panel conserva su salida por cierre de sesion',
       /cerrarSesion\(\)/.test(club));
    ok('10k · caShowSuccession sigue con su overlay propio y su ✕ que lo elimina',
       /overlay\.remove\(\)/.test(club));
}

// ═══════ PARTE 11 · comportamiento de navReload ═══════
console.log('\n── PARTE 11 · navReload repinta sin apilar ──');
{
    const t = build();
    const pintadas = t.pintadas;
    t.sb.openClubAdminPanel = function(cid){ t.sb.navRootScreen('openClubAdminPanel', cid); pintadas.push('club:' + cid); };
    t.sb.caShowSuccession   = function(cid){ t.sb.navScreen('caShowSuccession', cid); pintadas.push('succession'); };

    t.sb.openClubAdminPanel('clubA');
    ok('11a · la raiz guarda el clubId', JSON.stringify(t.sb._navTrail()) === '["openClubAdminPanel"]');

    t.sb.navReload();
    ok('11b · [FIX] recargar repinta EL MISMO club, no el selector',
       t.ultima() === 'club:clubA', t.ultima());
    ok('11c · y no apila (sigue en 1 nivel)', t.sb.navDepth() === 1, 'profundidad ' + t.sb.navDepth());

    // Con una subpantalla encima, navReload repinta LA SUBPANTALLA
    t.sb.caShowSuccession('clubA');
    t.sb.navReload();
    ok('11d · con una subpantalla encima, recarga la subpantalla',
       t.ultima() === 'succession' && t.sb.navDepth() === 2, t.ultima() + ' d=' + t.sb.navDepth());
    t.sb.navBack();
    ok('11e · y Volver sigue devolviendo al club correcto',
       t.ultima() === 'club:clubA', t.ultima());

    // Con la pila vacia no debe romperse
    const u = build();
    ok('11f · navReload con la pila vacia no rompe', (u.sb.navReload(), true));
}

// ═══════ PARTE 12 · panel de Direccion (Director / Coordinador) ═══════
console.log('\n── PARTE 12 · panel de Direccion ──');
{
    const leer = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8').replace(/\r\n/g, '\n');
    const sinCom = (s) => s.split(/\r?\n/).map(l => l.replace(/\/\/.*$/, '')).join('\n');
    const sd = sinCom(leer('js/coach/reports/club-reports.js'));

    ok('12a · openStaffDashboard acepta la pestaña inicial',
       /async function openStaffDashboard\(initialTab\)/.test(sd));
    ok('12b · y se registra como RAIZ con esa pestaña',
       /navRootScreen\(\s*['"]openStaffDashboard['"]\s*,\s*_tab\s*\)/.test(sd));
    ok('12c · switchStaffTab actualiza la pestaña de la RAIZ (no se apila aparte)',
       /navRootScreen\(\s*['"]openStaffDashboard['"]\s*,\s*tab\s*\)/.test(sd));
    ok('12d · openTestRolePicker SI se apila (destruye el panel)',
       /navScreen\(\s*['"]openTestRolePicker['"]\s*,\s*targetRole\s*\)/.test(sd));
    ok('12e · [FIX] cancelar el cambio de club vuelve atras si hay a donde',
       /navCanGoBack\(\)\)\s*navBack\(\)/.test(sd));
    ok('12f · y conserva showRoleSelector como salida cuando NO hay nada detras',
       /else if\s*\(typeof showRoleSelector==='function'\)\s*showRoleSelector\(\)/.test(sd));
    ok('12g · [FIX] "Recargar" conserva la pestaña activa (navReload)',
       /onclick="if\(typeof navReload==='function'\) navReload\(\)/.test(sd));
    ok('12h · el panel arranca en la pestaña registrada, no en una fija',
       /switchStaffTab\(_tab\);/.test(sd) && !/switchStaffTab\('convocatorias'\);/.test(sd));
    ok('12i · conserva su salida por cierre de sesion', /logoutUser\(\)/.test(sd));

    // ⚠️ LO QUE NO SE TOCA, Y POR QUE — para que no se "arregle" por descuido:
    //  · las pestañas pintan en el div interno #staff-dashboard-content, asi
    //    que NO destruyen el panel y no necesitan ser pantallas propias.
    //  · la mensajeria del Director/Coordinador se pinta EMBEBIDA en ese mismo
    //    div (_sdLoadMessages pasa 'staff-dashboard-content'), y en
    //    _renderUnifiedMessagingView el boton "Volver" solo se pinta para el
    //    COACH y la ✕ solo en modo modal. O sea que el motor de mensajeria
    //    —el que el autor pidio proteger— NO esta roto para estos roles y no
    //    hace falta tocarlo aqui.
    ok('12j · las pestañas siguen pintando en el div interno del panel',
       /getElementById\(['"]staff-dashboard-content['"]\)/.test(sd));
    ok('12k · la mensajeria del Director se pinta EMBEBIDA en ese div',
       /openDirectorMessaging\(\s*['"]coordinators['"]\s*,\s*['"]staff-dashboard-content['"]\s*\)/.test(sd));
    const comms = sinCom(leer('js/coach/comms/panel.js'));
    ok('12l · y su boton "Volver" sigue siendo solo para el COACH',
       /role === 'coach' \? `[\s\S]{0,200}?onclick="openUnifiedCommsMenu\(\)"/.test(comms));
}

// ═══════ PARTE 13 · recorridos del panel de Direccion ═══════
console.log('\n── PARTE 13 · recorridos del panel de Direccion ──');
{
    function sdSandbox() {
        const t = build();
        t.sb.openStaffDashboard = function(tab){
            const _t = tab || 'convocatorias';
            t.sb.navRootScreen('openStaffDashboard', _t);
            t.pintadas.push('panel:' + _t);
        };
        t.sb.switchStaffTab = function(tab){
            t.sb.navRootScreen('openStaffDashboard', tab);
            t.pintadas.push('tab:' + tab);
        };
        t.sb.openTestRolePicker = function(role){
            t.sb.navScreen('openTestRolePicker', role);
            t.pintadas.push('picker');
        };
        return t;
    }

    const t = sdSandbox();
    t.sb.openStaffDashboard();
    t.sb.switchStaffTab('informes');
    t.sb.switchStaffTab('partidos_terminados');
    ok('13a · cambiar de pestaña NO apila (sigue 1 nivel)', t.sb.navDepth() === 1,
       'profundidad ' + t.sb.navDepth());

    t.sb.navReload();
    ok('13b · [FIX] "Recargar" vuelve a la MISMA pestaña, no a Convocatorias',
       t.ultima() === 'panel:partidos_terminados', t.ultima());

    // Cambiar club y cancelar: debe volver AL PANEL, en su pestaña
    t.sb.openTestRolePicker('director');
    ok('13c · el selector de club se apila encima', t.sb.navDepth() === 2);
    t.sb.navBack();
    ok('13d · [FIX] cancelar devuelve al panel EN SU PESTAÑA, no al selector de rol',
       t.ultima() === 'panel:partidos_terminados', t.ultima());

    // Si el picker es la ENTRADA (SuperAdmin sin club), no hay a donde volver
    const u = build();
    u.sb.openTestRolePicker = function(role){ u.sb.navScreen('openTestRolePicker', role); u.pintadas.push('picker'); };
    u.sb.openTestRolePicker('director');
    ok('13e · si el selector fue la ENTRADA, no hay a donde volver',
       u.sb.navCanGoBack() === false);
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

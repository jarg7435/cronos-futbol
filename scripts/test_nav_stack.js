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
    // Los elementos se CACHEAN por id: asi se puede comprobar despues cual quedo
    // oculto. Sin esto no habia forma de medir el sintoma que reporto el autor
    // —"se ve el campo de futbol detras"—, que es exactamente que #main-container
    // sigue visible. Antes getElementById devolvia un objeto nuevo cada vez y el
    // display se perdia.
    const els = {};
    const sb = {
        console: { log() {}, warn() {}, error() {} },
        document: {
            getElementById: (id) => (els[id] = els[id] || { id, style: {}, innerHTML: '' }),
            body: { style: {}, classList: { remove() {} } },
        },
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

    return { sb, pintadas, els, ultima: () => pintadas[pintadas.length - 1],
             visible: (id) => (els[id] ? els[id].style.display : undefined) !== 'none' };
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
    // ⚠️ ESTA ASERCION HA CAMBIADO TRES VECES, una por cada forma que ha tenido la
    // ✕ de este menu: navExit() (ronda 2), navBack() con respaldo (v403) y
    // navExitToRoles() (v404, la definitiva). Las dos primeras dejaban al usuario
    // dentro del partido. Lo que se conserva en las tres es la INTENCION original:
    // que ninguna de las dos salidas sea un destino cableado a mano.
    ok('6·el menu de Comunicaciones: "Volver" navega y la ✕ sale del area',
       /onclick="navBack\(\)"/.test(cuerpoMenu) && /navExitToRoles\(\)/.test(cuerpoMenu));
    ok('6·y su ✕ ya no llama a openSetupModal cableado',
       !/openSetupModal==='function'\?openSetupModal\(\)/.test(cuerpoMenu));

    // ⚠️ LO QUE QUEDA CABLEADO A PROPOSITO. Este censo fija el limite exacto
    // de la migracion, para que no se cuele ninguno nuevo por descuido.
    //   · panel.js YA NO ESTA EN ESTA LISTA. Era el motor de mensajeria, que se
    //     migro en la RONDA 7 (PARTES 16 y 17): su "Volver" es navBack() y su ✕
    //     navExit(). Al migrarlo esta asercion se puso ROJA exigiendo el defecto
    //     —igual que paso en la ronda 2 con contact-manager y training-notify—,
    //     asi que el fichero PASA a la lista TODOS de abajo: de "queda 1
    //     cableado" a "no puede tener ninguno".
    //   · individual-reports  -> openIndividualReports, SIN punto de entrada
    //     localizable en el repo (lo documenta su propia cabecera).
    //   · collective-report   -> openCollectiveReport, tambien SIN invocador:
    //     el boton "INFORMES COLECTIVOS" del post-partido llama a
    //     openMisInformesColectivos, que NO EXISTE en el proyecto.
    const PENDIENTES = {
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
                   'js/core/setup-modal.js',
                   // Asciende desde PENDIENTES al migrarse el motor (ronda 7).
                   'js/coach/comms/panel.js'];
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
    // ⚠️ ACTUALIZADA EN LA RONDA 7 (misma familia que las dos inversiones de la
    // ronda 2). Fijaba la forma vieja —`role === 'coach' ?` con destino cableado
    // a openUnifiedCommsMenu()— y al migrar el motor se puso roja exigiendo el
    // defecto. La INTENCION no cambia: el Director/Coordinador sigue sin
    // "Volver". La condicion es ahora ESTRICTAMENTE mas estrecha, porque ademas
    // exige modo modal: el coach EMBEBIDO tampoco lo pinta, y asi no puede
    // destruir el panel anfitrion si algun dia se cablea esa via (hoy muerta,
    // declarada en 16q/16r/16s).
    ok('12l · y su boton "Volver" sigue siendo solo para el COACH, y solo en modal',
       /role === 'coach' && isModalMode \?/.test(comms) &&
       !/role === 'coach' \? `[\s\S]{0,200}?onclick="openUnifiedCommsMenu\(\)"/.test(comms));
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

// ═══════ PARTE 14 · panel de Padres ═══════
console.log('\n── PARTE 14 · panel de Padres ──');
{
    const leer = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8').replace(/\r\n/g, '\n');
    // Filtra comentarios // Y comentarios HTML: este fichero tiene <!-- --> DENTRO
    // de los template literals, y uno de ellos nombra data-coach-label. Sin este
    // segundo filtro una asercion podria medir el comentario en vez del codigo.
    const sinCom = (s) => s.split(/\r?\n/).map(l => l.replace(/\/\/.*$/, '')).join('\n')
                           .replace(/<!--[\s\S]*?-->/g, '');
    const pp = sinCom(leer('js/parent/panel.js'));

    ok('14a · openParentPanel acepta la pestaña inicial',
       /async function openParentPanel\(initialTab\)/.test(pp));
    ok('14b · y se registra como RAIZ con esa pestaña',
       /navRootScreen\(\s*['"]openParentPanel['"]\s*,\s*_tab\s*\)/.test(pp));
    ok('14c · ppTab actualiza la pestaña de la RAIZ (no se apila aparte)',
       /navRootScreen\(\s*['"]openParentPanel['"]\s*,\s*tab\s*\)/.test(pp));
    // El arranque fijo era `ppNotifsByType('convocatoria');` como SENTENCIA.
    // Acotado con ; al final de linea: la misma llamada sigue existiendo dentro
    // del router (`conv: () => ppNotifsByType('convocatoria'),`, con coma) y
    // prohibirla del todo daria rojo por la razon equivocada.
    ok('14d · el panel arranca en la pestaña registrada, no en una fija',
       /ppTab\(_tab\);/.test(pp) && !/^\s*ppNotifsByType\('convocatoria'\);\s*$/m.test(pp));

    for (const tab of ['conv', 'train', 'player', 'chat', 'live']) {
        ok(`14e·${tab} · el boton de pestaña lleva id para reactivarse sin \`this\``,
           new RegExp('id="pp-tab-' + tab + '"').test(pp));
    }
    ok('14f · y ppTab localiza el boton por ese id cuando no hay `this`',
       /panel\.querySelector\('#pp-tab-' \+ tab\)/.test(pp));

    ok('14g · el hilo de chat SI se apila, con sus argumentos',
       /navScreen\(\s*['"]ppOpenChatThread['"]\s*,\s*threadId\s*,\s*coachLabel\s*\)/.test(pp));

    // ── EL DEFECTO DEL EMOJI ──────────────────────────────────────────────
    // Acotar por la siguiente declaracion en columna 0, NUNCA por un numero
    // fijo de caracteres (leccion de la ronda 2).
    const iSend = pp.indexOf('window.ppSendChatMessage');
    const iFinSend = pp.slice(iSend + 1).search(/\n(?:async )?function \w+\s*\(|\nwindow\.\w+\s*=/);
    const cuerpoSend = iSend > -1
        ? pp.slice(iSend, iFinSend > -1 ? iSend + 1 + iFinSend : pp.length)
        : pp;
    ok('14h · [FIX] tras enviar, el hilo se repinta con navReload()',
       /if \(typeof navReload === 'function'\) navReload\(\)/.test(cuerpoSend));
    ok('14i · [FIX] y ya no se raspa el label del TEXTO VISIBLE de la cabecera',
       !/font-weight:700"\]/.test(cuerpoSend) && !/\?\.textContent/.test(cuerpoSend));
    ok('14j · el respaldo lee el label CRUDO del data-attribute',
       /dataset\.coachLabel/.test(cuerpoSend));
    ok('14k · y la cabecera del hilo publica ese label crudo',
       /data-coach-label="\$\{/.test(pp) && /id="pp-chat-title"/.test(pp));

    // ⚠️ LO QUE NO SE TOCA, Y POR QUE — para que no se "arregle" por descuido:
    //  · las pestañas pintan en el div interno #pp-body, asi que NO destruyen el
    //    panel y no pueden ser pantallas propias (misma forma que el panel de
    //    Direccion): la pestaña activa viaja como ARGUMENTO de la raiz.
    //  · el panel no tiene ✕: su unica salida es "⏻ Salir" con cierre de sesion,
    //    igual que el del SuperAdmin, asi que navExit() no aplica aqui.
    //  · el "← Volver" del hilo sigue llamando a ppChat() a proposito: repinta
    //    solo el cuerpo en vez de reconstruir el panel entero, y como ppChat
    //    re-registra la RAIZ la pila queda igual de coherente que con navBack.
    //  · la pestaña de Mensajes entra en el MOTOR de mensajeria unificada, que
    //    sigue fuera de alcance (se migra aparte y con guard propio).
    ok('14l · las pestañas siguen pintando en el div interno del panel',
       /getElementById\('pp-body'\)/.test(pp));
    ok('14m · el panel conserva su salida por cierre de sesion',
       /logoutUser\(\)/.test(pp));
    ok('14n · la pestaña de Mensajes sigue delegando en el motor unificado',
       /openParentMessaging\(\s*['"]coach['"]\s*,\s*['"]pp-body['"]\s*\)/.test(pp));
    ok('14o · y la lista de hilos re-registra la RAIZ (no deja la pila en el hilo)',
       /navRootScreen\(\s*['"]openParentPanel['"]\s*,\s*['"]chat['"]\s*\)/.test(pp));

    // ⚠️ 14p · EL FICHERO TIENE QUE PARSEAR. Esta ronda introdujo un comentario
    // HTML DENTRO del template literal del innerHTML con backticks alrededor de
    // "this": el primer backtick CIERRA el template y rompe el fichero completo,
    // dejando openParentPanel sin definir y el panel de Padres muerto en el
    // navegador. Ni la suite ni las 15 aserciones de texto de arriba lo vieron,
    // porque todas leen el fichero como TEXTO y ninguna lo parsea.
    // Se comprueban los ficheros migrados que se pintan con template literals.
    const PARSEA = ['js/parent/panel.js', 'js/core/nav-stack.js',
                    'js/coach/reports/club-reports.js', 'js/coach/comms/panel.js'];
    for (const archivo of PARSEA) {
        let err = null;
        try { new vm.Script(leer(archivo), { filename: archivo }); }
        catch (e) { err = e.message; }
        ok(`14p·${archivo} · parsea como JavaScript valido`, err === null, err);
    }
}

// ═══════ PARTE 15 · recorridos del panel de Padres ═══════
console.log('\n── PARTE 15 · recorridos del panel de Padres ──');
{
    function ppSandbox() {
        const t = build();
        t.sb._cabecera = '';
        t.sb.openParentPanel = function(tab) {
            const _t = tab || 'conv';
            t.sb.navRootScreen('openParentPanel', _t);
            t.pintadas.push('panel:' + _t);
        };
        t.sb.ppTab = function(tab) {
            t.sb.navRootScreen('openParentPanel', tab);
            t.pintadas.push('tab:' + tab);
        };
        t.sb.ppChat = function() {
            t.sb.navRootScreen('openParentPanel', 'chat');
            t.pintadas.push('lista');
        };
        // La cabecera real pinta "⚽ " + label. Modelarla es lo que permite
        // MEDIR el defecto del emoji en vez de deducirlo.
        t.sb.ppOpenChatThread = function(id, label) {
            t.sb.navScreen('ppOpenChatThread', id, label);
            t.sb._cabecera = '⚽ ' + label;
            t.pintadas.push('hilo:' + label);
        };
        return t;
    }

    const t = ppSandbox();
    t.sb.openParentPanel();
    ok('15a · el panel arranca en Convocatorias con la pila en 1 nivel',
       t.ultima() === 'panel:conv' && t.sb.navDepth() === 1, t.ultima());

    t.sb.ppTab('train'); t.sb.ppTab('live'); t.sb.ppTab('chat');
    ok('15b · cambiar de pestaña NO apila (sigue 1 nivel)', t.sb.navDepth() === 1,
       'profundidad ' + t.sb.navDepth());

    t.sb.ppOpenChatThread('t1', 'Pedro Ruiz');
    ok('15c · el hilo de chat SI se apila encima', t.sb.navDepth() === 2,
       'profundidad ' + t.sb.navDepth());

    // "Enviar" tres veces: navReload repinta con los argumentos de la pila
    t.sb.navReload(); t.sb.navReload(); t.sb.navReload();
    ok('15d · [FIX] enviar tres veces NO acumula emojis en el titulo del chat',
       t.sb._cabecera === '⚽ Pedro Ruiz', t.sb._cabecera);
    ok('15e · y el repintado no apila (sigue en el hilo, 2 niveles)',
       t.sb.navDepth() === 2 && t.sb.navCurrent() === 'ppOpenChatThread',
       t.sb.navCurrent() + ' d=' + t.sb.navDepth());

    t.sb.ppChat();
    ok('15f · el "Volver" del hilo deja la pila en la RAIZ, no en una pantalla ya destruida',
       t.sb.navDepth() === 1 && t.sb.navCurrent() === 'openParentPanel',
       t.sb.navCurrent() + ' d=' + t.sb.navDepth());

    // AUTO-VERIFICACION: con el repintado VIEJO —volver a pasar como label el
    // texto visible de la cabecera— 15d daria rojo. Si esto no acumulase, 15d
    // no estaria midiendo nada.
    const u = ppSandbox();
    u.sb.openParentPanel(); u.sb.ppTab('chat');
    u.sb.ppOpenChatThread('t1', 'Pedro Ruiz');
    for (let i = 0; i < 3; i++) u.sb.ppOpenChatThread('t1', u.sb._cabecera);
    ok('15g · auto-verificacion: el repintado VIEJO si acumulaba un emoji por envio',
       u.sb._cabecera === '⚽ ⚽ ⚽ ⚽ Pedro Ruiz', u.sb._cabecera);
}

// ═══════ PARTE 16 · el MOTOR de mensajeria unificada ═══════
// La zona que el autor pidio proteger. QUINTA forma distinta: el motor es de
// DOBLE MODO —modal en #setup-modal, o embebido en el contenedor que le pasa el
// anfitrion— y lo decide en tiempo de ejecucion segun si ese contenedor existe.
//
// 🔑 LA REGLA QUE HACE SEGURA LA MIGRACION: es pantalla de la pila SOLO en modo
// modal. Embebido, la RAIZ del anfitrion ya lo posee (openStaffDashboard para
// Director/Coordinador, openParentPanel para Padres); registrarlo ahi haria que
// navBack lo repintase en un contenedor ya destruido — la misma trampa que la
// ronda 5 documento para switchStaffTab.
console.log('\n── PARTE 16 · motor de mensajeria unificada ──');
{
    const leer = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8').replace(/\r\n/g, '\n');
    const sinCom = (s) => s.split(/\r?\n/).map(l => l.replace(/\/\/.*$/, '')).join('\n')
                           .replace(/<!--[\s\S]*?-->/g, '');
    const um = sinCom(leer('js/coach/comms/panel.js'));

    // Acotar por la siguiente declaracion en columna 0 (leccion de la ronda 2):
    // este fichero tiene OTRO navBack() y OTRO navExit() legitimos, los de
    // openUnifiedCommsMenu migrado en la ronda 2. Sin acotar, 16g/16i darian
    // verde midiendo el menu en vez del motor.
    const acotar = (src, decl) => {
        const i = src.indexOf(decl);
        if (i < 0) return '';
        const fin = src.slice(i + 1).search(/\n(?:async )?function \w+\s*\(|\nwindow\.\w+\s*=/);
        return src.slice(i, fin > -1 ? i + 1 + fin : src.length);
    };
    const cuerpoRender = acotar(um, 'async function _renderUnifiedMessagingView');
    const cuerpoSwitch = acotar(um, 'async function _switchUnifiedTab');
    ok('16·control · las dos regiones se acotan (si no, todo lo demas miente)',
       cuerpoRender.length > 500 && cuerpoSwitch.length > 300,
       'render=' + cuerpoRender.length + ' switch=' + cuerpoSwitch.length);

    // ── el mapa rol -> funcion de entrada ──
    for (const [rol, fn] of [['coach', 'openCoachMessaging'], ['director', 'openDirectorMessaging'],
                             ['coordinator', 'openCoordinatorMessaging'], ['parent', 'openParentMessaging']]) {
        ok(`16a·${rol} · el mapa rol->entrada cubre ${rol}`,
           new RegExp(rol + ":\\s*'" + fn + "'").test(um));
    }

    // ── 🔑 el registro, condicionado al modo modal ──
    ok('16b · el motor se registra SOLO en modo modal',
       /if \(isModalMode && typeof navScreen === 'function'\)/.test(cuerpoRender));
    ok('16c · y lo hace con la pestaña, por la entrada del rol',
       /navScreen\(_UM_ENTRY_BY_ROLE\[role\] \|\| 'openCoachMessaging', tab\)/.test(cuerpoRender));
    ok('16d · el registro va ANTES del primer await (invariante async de la ronda 3)',
       (() => {
           const iReg = cuerpoRender.indexOf('navScreen(_UM_ENTRY_BY_ROLE');
           const iAwait = cuerpoRender.indexOf('await ');
           return iReg > -1 && (iAwait === -1 || iReg < iAwait);
       })(), 'reg=' + cuerpoRender.indexOf('navScreen(_UM_ENTRY_BY_ROLE') + ' await=' + cuerpoRender.indexOf('await '));

    // ── las pestañas son INTERNAS: actualizan el argumento, no se apilan ──
    ok('16e · _switchUnifiedTab actualiza la pestaña guardada, solo en modal',
       /if \(!window\._umState\.containerId && typeof navScreen === 'function'\)/.test(cuerpoSwitch));
    ok('16f · y sigue SIN repintar el motor (las pestañas no son pantallas)',
       !/_renderUnifiedMessagingView\(/.test(cuerpoSwitch));
    ok('16g · el primer LECTOR de _umState.containerId, que antes no se leia nunca',
       /window\._umState\.containerId/.test(cuerpoSwitch));

    // ── 🐛 EL BUG DE DATOS DE ESTA RONDA ────────────────────────────────
    // "🔄 Actualizar" cocia la pestaña en el onclick al pintar el header, y el
    // header NO se vuelve a pintar nunca. Tras cambiar de pestaña, el boton
    // recargaba la lista de la pestaña VIEJA mientras el subrayado y
    // _umState.activeTab decian la nueva. Y con la lista desincronizada,
    // _selectUnifiedContact compone el threadId con _getCanonicalContext(role,
    // activeTab), o sea el contexto EQUIVOCADO para ese contacto: el mensaje
    // cae en un hilo que el destinatario no lee.
    ok('16h · [FIX] "Actualizar" lee la pestaña ACTIVA del estado',
       /_loadUnifiedContactList\(\(window\._umState&&window\._umState\.activeTab\)/.test(cuerpoRender));
    ok('16i · [FIX] y ya no queda la pestaña cocida en el onclick',
       !/_loadUnifiedContactList\('\$\{tab\}'\)/.test(cuerpoRender));
    // El eslabon que convierte la observacion en bug: que la lista se
    // desincronice solo importa si el threadId depende de activeTab.
    ok('16j · el threadId depende de activeTab (por eso desincronizar es grave)',
       /_getCanonicalContext\(window\._umState\.role, window\._umState\.activeTab\)/.test(um));
    ok('16k · y _loadUnifiedContactList NO escribe activeTab (por eso no se auto-cura)',
       !/activeTab\s*=/.test(acotar(um, 'async function _loadUnifiedContactList')));

    // ── Volver y ✕: dos botones, dos funciones ──
    ok('16l · el "Volver" del coach usa navBack()',
       /onclick="navBack\(\)"/.test(cuerpoRender));
    ok('16m · y solo se pinta en modo MODAL (embebido lo posee el anfitrion)',
       /role === 'coach' && isModalMode \?/.test(cuerpoRender));
    ok('16n · la ✕ es una salida de verdad (navExit)',
       /onclick="navExit\(\)"/.test(cuerpoRender));
    ok('16o · y desaparece la cadena de 4 ramas, 3 de ellas muertas',
       !/else if\(typeof openStaffDashboard==='function'\)/.test(cuerpoRender));
    ok('16p · la seleccion de contacto sigue pintando en el div interno',
       /getElementById\('um-chat-view'\)/.test(um));

    // ⚠️ RAMAS MUERTAS DECLARADAS, NO TOCADAS (decision del autor, 2026-07-29).
    // Se fija su forma exacta: si alguien las cablea, el guard se pone rojo y
    // obliga a revisar destinos. Misma politica que openIndividualReports /
    // openCollectiveReport en la PARTE 6.
    //  · club-reports.js:368 embebe el motor con rol COACH, pero la rama else
    //    de _sdLoadMessages es INALCANZABLE: las dos unicas entradas a
    //    openStaffDashboard garantizan _activeRole director|coordinator.
    const sd = sinCom(leer('js/coach/reports/club-reports.js'));
    const rl = sinCom(leer('js/services/auth/role-launch.js'));
    ok('16q · la rama else que embeberia el motor como COACH sigue ahi',
       /openCoachMessaging\('parents', 'staff-dashboard-content'\)/.test(sd));
    ok('16r · pero role-launch solo deja entrar a director|coordinator',
       /\['director', 'coordinator'\]\.includes\(activeRole\)/.test(rl));
    ok('16s · y el modo prueba fuerza _activeRole a uno de esos dos',
       /_activeRole = role === 'director' \? 'director' : 'coordinator'/.test(sd));

    //  · openBulkMessageComposer y sus 3 vueltas: sin invocador en todo el repo.
    const walk = (dir, acc) => {
        for (const e of fs.readdirSync(path.join(ROOT, dir), { withFileTypes: true })) {
            const rel = dir + '/' + e.name;
            if (e.isDirectory()) walk(rel, acc);
            else if (e.name.endsWith('.js')) acc.push(rel);
        }
        return acc;
    };
    const invocadores = walk('js', []).filter(f =>
        f !== 'js/coach/comms/bulk-messaging.js' && /openBulkMessageComposer/.test(sinCom(leer(f))));
    ok('16t · openBulkMessageComposer sigue SIN invocador (flujo muerto declarado)',
       invocadores.length === 0, invocadores.join(', '));
}

// ═══════ PARTE 17 · recorridos del motor ═══════
console.log('\n── PARTE 17 · recorridos del motor de mensajeria ──');
{
    // Modela las DOS formas del motor con la misma funcion, que es lo que hace
    // el codigo real: si le pasan contenedor es embebido y NO se apila.
    function motorSandbox() {
        const t = build();
        t.sb._umState = { role: 'coach', activeTab: 'parents', containerId: null };
        t.sb.openStaffDashboard = function(tab) {
            t.sb.navRootScreen('openStaffDashboard', tab || 'convocatorias');
            t.pintadas.push('sd:' + (tab || 'convocatorias'));
        };
        t.sb.openParentPanel = function(tab) {
            t.sb.navRootScreen('openParentPanel', tab || 'conv');
            t.pintadas.push('pp:' + (tab || 'conv'));
        };
        t.sb.openCoachMessaging = function(tab, cont) {
            tab = tab || 'parents';
            t.sb._umState.role = 'coach';
            t.sb._umState.activeTab = tab;
            t.sb._umState.containerId = cont || null;
            if (!cont) t.sb.navScreen('openCoachMessaging', tab);
            t.pintadas.push('motor:' + tab + (cont ? '@' + cont : '@modal'));
        };
        t.sb._switchUnifiedTab = function(tabId) {
            t.sb._umState.activeTab = tabId;
            if (!t.sb._umState.containerId) t.sb.navScreen('openCoachMessaging', tabId);
            t.pintadas.push('tab:' + tabId);
        };
        return t;
    }

    // ── MODAL · el caso live: dos entradas, un "Volver" ──
    // Hoy el "Volver" esta cableado a openUnifiedCommsMenu(), asi que entrar
    // desde el modal de setup te dejaba en el menu de Comunicaciones, una
    // pantalla por la que no habias pasado.
    const a = motorSandbox();
    a.sb.openSetupModal();
    a.sb.openCoachMessaging('parents');
    ok('17a · modal: el motor se apila encima de su entrada', a.sb.navDepth() === 2,
       'profundidad ' + a.sb.navDepth());
    a.sb.navBack();
    ok('17b · [FIX] entrando desde el modal de setup, Volver devuelve AL MODAL',
       a.ultima() === 'openSetupModal', a.ultima());

    const b = motorSandbox();
    b.sb.openSetupModal();
    b.sb.openUnifiedCommsMenu();
    b.sb.openCoachMessaging('parents');
    b.sb.navBack();
    ok('17c · y entrando desde Comunicaciones, devuelve al MENU',
       b.ultima() === 'openUnifiedCommsMenu', b.ultima());

    // ── MODAL · las pestañas son hermanas, no niveles ──
    const c = motorSandbox();
    c.sb.openSetupModal();
    c.sb.openCoachMessaging('parents');
    c.sb._switchUnifiedTab('director');
    c.sb._switchUnifiedTab('coordinator');
    ok('17d · cambiar de pestaña NO apila (sigue en 2 niveles)', c.sb.navDepth() === 2,
       'profundidad ' + c.sb.navDepth());
    c.sb.navReload();
    ok('17e · y "recargar" repinta la pestaña ACTIVA, no la de entrada',
       c.ultima() === 'motor:coordinator@modal', c.ultima());
    c.sb.navBack();
    ok('17f · y Volver sigue saliendo a la entrada real, no a la pestaña anterior',
       c.ultima() === 'openSetupModal', c.ultima());

    // ── EMBEBIDO · el motor NO es pantalla ──
    const d = motorSandbox();
    d.sb.openStaffDashboard('mensajes');
    d.sb.openCoachMessaging('parents', 'staff-dashboard-content');
    ok('17g · embebido: el motor NO se apila (la raiz del anfitrion sigue al mando)',
       d.sb.navDepth() === 1 && d.sb.navCurrent() === 'openStaffDashboard',
       d.sb.navCurrent() + ' d=' + d.sb.navDepth());
    d.sb._switchUnifiedTab('director');
    ok('17h · y cambiar su pestaña embebida tampoco toca la pila',
       d.sb.navDepth() === 1 && d.sb.navCurrent() === 'openStaffDashboard',
       d.sb.navCurrent() + ' d=' + d.sb.navDepth());
    d.sb.navReload();
    ok('17i · 🔑 recargar repinta EL ANFITRION en su pestaña, no el motor',
       d.ultima() === 'sd:mensajes', d.ultima());

    // Lo mismo con Padres, que es el otro anfitrion embebido
    const e = motorSandbox();
    e.sb.openParentPanel('chat');
    e.sb.openCoachMessaging('parents', 'pp-body');
    ok('17j · embebido en el panel de Padres: tampoco se apila',
       e.sb.navDepth() === 1 && e.sb.navCurrent() === 'openParentPanel',
       e.sb.navCurrent() + ' d=' + e.sb.navDepth());

    // ── la ✕ sale de verdad ──
    const f = motorSandbox();
    f.sb.openSetupModal();
    f.sb.openCoachMessaging('parents');
    f.sb.navExit();
    ok('17k · la ✕ (navExit) vacia la pila: salida limpia, no un Volver disfrazado',
       f.sb.navDepth() === 0 && f.sb.navCanGoBack() === false,
       'profundidad ' + f.sb.navDepth());
}

// ═══════ PARTE 18 · "Partidos Terminados" (reportado por el autor) ═══════
// Sintoma que dio el autor: la ✕ "destruye la capa del modal dejando visible de
// fondo la pantalla del partido en directo (campo de futbol)".
//
// ⚠️ Y PIDIO navExit(), QUE NO LO ARREGLA. navExit() hace `_stack = []` mas
// `setup-modal.style.display = 'none'`, y el onclick de hoy ya hace exactamente
// ese display='none'. Ocultar #setup-modal es LA CAUSA de que se vea el campo,
// no la cura. Lo que quita el sintoma es navBack(), que REPINTA la pantalla de
// origen dentro de #setup-modal. La asercion 19e lo demuestra midiendo las dos.
console.log('\n── PARTE 18 · Partidos Terminados ──');
{
    const leer = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8').replace(/\r\n/g, '\n');
    const sinCom = (s) => s.split(/\r?\n/).map(l => l.replace(/\/\/.*$/, '')).join('\n')
                           .replace(/<!--[\s\S]*?-->/g, '');
    const ai = sinCom(leer('js/core/app-init.js'));

    const i = ai.indexOf('async function showFinishedMatches');
    const f = ai.slice(i + 1).search(/\n(?:async )?function \w+\s*\(|\nwindow\.\w+\s*=/);
    const cuerpo = i > -1 ? ai.slice(i, f > -1 ? i + 1 + f : ai.length) : '';
    ok('18·control · la region de showFinishedMatches se acota', cuerpo.length > 800,
       'len=' + cuerpo.length);

    ok('18a · showFinishedMatches se auto-registra en la pila',
       /navScreen\('showFinishedMatches'\)/.test(cuerpo));

    // 🔑 El registro va DESPUES de las dos salidas tempranas. Si fuera lo primero,
    // un plan sin el extra `partidos_terminados` apilaria una pantalla que NUNCA
    // se pinta, y el siguiente navBack restauraria un modal invisible.
    ok('18b · y va DESPUES de las dos salidas tempranas (extra y modal ausente)',
       (() => {
           const iReg = cuerpo.indexOf("navScreen('showFinishedMatches')");
           const iExtra = cuerpo.indexOf("_ptExtras.partidos_terminados === false");
           const iModal = cuerpo.indexOf('if (!modal) return;');
           return iReg > -1 && iExtra > -1 && iModal > -1 && iReg > iExtra && iReg > iModal;
       })());
    ok('18c · y ANTES del primer await (invariante async de la ronda 3)',
       (() => {
           const iReg = cuerpo.indexOf("navScreen('showFinishedMatches')");
           const iAwait = cuerpo.indexOf('await ');
           return iReg > -1 && (iAwait === -1 || iReg < iAwait);
       })());

    // ⚠️ v404: esta pantalla tenia UNA sola salida (la ✕) que ademas hacia el
    // trabajo de "Volver". Ahora tiene las DOS del requisito original del autor:
    // "Volver" deshace el camino y la ✕ abandona el area. La ✕ NO puede ser
    // navBack() —forma de v402— porque eso te deja dentro del partido.
    ok('18d · [FIX] tiene un "← Volver" con navBack()',
       /onclick="navBack\(\)"[\s\S]{0,300}?← Volver/.test(cuerpo));
    ok('18e · [FIX] y la ✕ sale del area con navExitToRoles()',
       /onclick="if\(typeof navExitToRoles==='function'\) navExitToRoles\(\)[\s\S]{0,200}?✕/.test(cuerpo));
    ok('18j · la ✕ ya no oculta #setup-modal a pelo (forma original)',
       !/onclick="document\.getElementById\('setup-modal'\)\.style\.display='none';"[\s\S]{0,200}?✕/.test(cuerpo));
    ok('18k · ni es navBack() a secas (forma de v402, dejaba dentro del partido)',
       !/onclick="navBack\(\)"[\s\S]{0,80}?title="Volver">✕/.test(cuerpo));

    // Las DOS vias de entrada reales tienen que estar apiladas, o navBack no
    // tendria a donde volver. Las dos se migraron en la ronda 2.
    ok('18f · la via del menu de Comunicaciones sigue existiendo',
       /showFinishedMatches\(\)/.test(sinCom(leer('js/coach/comms/panel.js'))));
    ok('18g · y la del modal de 3 opciones, que SI se apila',
       /navScreen\('_openCoachCommsMenu'\)/.test(sinCom(leer('js/core/setup-modal.js'))));

    // ⚠️ LO QUE NO SE TOCA, Y POR QUE:
    //  · el boton de cada partido oculta el modal a proposito para lanzar el
    //    reproductor, que toma la pantalla entera. NO es una ✕.
    //  · openPastMatchesModal es un respaldo MUERTO: no existe en el proyecto
    //    (misma familia que openMisInformesColectivos). Gana siempre la primera
    //    rama porque showFinishedMatches si existe.
    ok('18h · el boton de repeticion sigue ocultando el modal a proposito',
       /style\.display='none'; window\.openMatchReplay/.test(cuerpo));
    // ⚠️ `openPastMatchesModal\s*=` casaba con `openPastMatchesModal==='function'`
    // del propio typeof —el primer `=` de `===`—, o sea que media la GUARDA en vez
    // de una definicion y daba rojo por la razon equivocada. El `[^=]` lo excluye.
    const invocado = ['js/core/app-init.js', 'js/core/setup-modal.js', 'js/coach/comms/panel.js']
        .some(p => /function openPastMatchesModal|openPastMatchesModal\s*=[^=]/.test(sinCom(leer(p))));
    ok('18i · openPastMatchesModal sigue sin existir (respaldo muerto declarado)',
       invocado === false);
}

// ═══════ PARTE 19 · recorridos de Partidos Terminados ═══════
console.log('\n── PARTE 19 · recorridos de Partidos Terminados ──');
{
    function ptSandbox() {
        const t = build();
        t.sb._openCoachCommsMenu = function() {
            t.sb.navScreen('_openCoachCommsMenu'); t.pintadas.push('menu3');
        };
        t.sb.showFinishedMatches = function() {
            t.sb.navScreen('showFinishedMatches'); t.pintadas.push('terminados');
        };
        return t;
    }

    // Via 1: menu de Comunicaciones
    const a = ptSandbox();
    a.sb.openSetupModal();
    a.sb.openUnifiedCommsMenu();
    a.sb.showFinishedMatches();
    ok('19a · se apila encima de su entrada', a.sb.navDepth() === 3,
       'profundidad ' + a.sb.navDepth());
    a.sb.navBack();
    ok('19b · [FIX] entrando por Comunicaciones, la ✕ devuelve AL MENU',
       a.ultima() === 'openUnifiedCommsMenu', a.ultima());

    // Via 2: modal de 3 opciones
    const b = ptSandbox();
    b.sb.openSetupModal();
    b.sb._openCoachCommsMenu();
    b.sb.showFinishedMatches();
    b.sb.navBack();
    ok('19c · [FIX] y entrando por el modal de 3 opciones, devuelve A ESE MODAL',
       b.ultima() === 'menu3', b.ultima());

    // El refresco tras borrar un partido se llama a si mismo: no debe apilar.
    const c = ptSandbox();
    c.sb.openSetupModal();
    c.sb.openUnifiedCommsMenu();
    c.sb.showFinishedMatches();
    c.sb.showFinishedMatches();   // deleteFinishedMatch -> showFinishedMatches()
    ok('19d · el refresco tras borrar NO apila un nivel mas', c.sb.navDepth() === 3,
       'profundidad ' + c.sb.navDepth());

    // ── 🔑 LA MEDIDA QUE COMPARA LAS DOS SALIDAS ──────────────────────────
    // Con navExit no se repinta NADA: la ultima pantalla pintada sigue siendo
    // "terminados", el modal se oculta y debajo aparece lo que hubiera — el campo
    // de futbol. Con navBack se repinta el origen, asi que el campo no se ve.
    const d = ptSandbox();
    d.sb.openSetupModal();
    d.sb.openUnifiedCommsMenu();
    d.sb.showFinishedMatches();
    const antes = d.ultima();
    d.sb.navExit();
    ok('19e · 🔑 navExit NO repinta nada (de ahi que se viera el campo detras)',
       d.ultima() === antes && d.sb.navDepth() === 0,
       'ultima=' + d.ultima() + ' d=' + d.sb.navDepth());

    const e = ptSandbox();
    e.sb.openSetupModal();
    e.sb.openUnifiedCommsMenu();
    e.sb.showFinishedMatches();
    e.sb.navBack();
    ok('19f · 🔑 navBack SI repinta el origen: es lo que tapa el campo',
       e.ultima() === 'openUnifiedCommsMenu' && e.sb.navDepth() === 2,
       'ultima=' + e.ultima() + ' d=' + e.sb.navDepth());

    // ── v404 · las DOS salidas hacen cosas DISTINTAS ──────────────────────
    // Mismo modelo de capas que la PARTE 21: el campo esta en #main-container.
    const h = ptSandbox();
    h.sb.document.getElementById('main-container').style.display = 'flex';
    h.sb.showRoleSelector = function() { h.pintadas.push('selector'); };
    h.sb.openSetupModal();
    h.sb.openUnifiedCommsMenu();
    h.sb.showFinishedMatches();
    ok('19h · control · el campo se ve mientras estas en Partidos Terminados',
       h.visible('main-container'));
    h.sb.navBack();
    ok('19i · "← Volver" devuelve a Comunicaciones y NO te saca del partido',
       h.ultima() === 'openUnifiedCommsMenu' && h.visible('main-container'));

    const j = ptSandbox();
    j.sb.document.getElementById('main-container').style.display = 'flex';
    j.sb.showRoleSelector = function() { j.pintadas.push('selector'); };
    j.sb.openSetupModal();
    j.sb.openUnifiedCommsMenu();
    j.sb.showFinishedMatches();
    j.sb.navExitToRoles();
    ok('19j · [FIX] la ✕ SI oculta el campo y lleva al selector',
       j.visible('main-container') === false && j.ultima() === 'selector' &&
       j.sb.navDepth() === 0);

    // Auto-verificacion: SIN registrar la pantalla, navBack se salta un nivel.
    const g = build();
    g.sb.showFinishedMatchesSinRegistrar = function() { g.pintadas.push('terminados'); };
    g.sb.openSetupModal();
    g.sb.openUnifiedCommsMenu();
    g.sb.showFinishedMatchesSinRegistrar();
    g.sb.navBack();
    ok('19g · auto-verificacion: sin auto-registrarse, navBack se salta un nivel',
       g.ultima() === 'openSetupModal', g.ultima());
}

// ═══════ PARTE 20 · la ✕ del menu de Comunicaciones (reportado por el autor) ═══════
// Segundo hallazgo del autor probando en navegador, misma causa que el de
// "Partidos Terminados": ocultar #setup-modal descubre lo que hay DEBAJO, y a
// este menu se entra desde el POST-PARTIDO, o sea que debajo esta la pantalla
// del partido en vivo (el campo).
//
// 🔑 REVIERTE UNA DECISION DE LA RONDA 2, que puso ahi navExit() a proposito para
// que el motor tuviera "una ✕ que sale de verdad". Medido contra la app real, esa
// salida limpia era el sintoma. La leccion: navExit() solo sirve cuando lo que
// queda debajo es aceptable; si debajo hay una pantalla de trabajo, la salida
// tiene que REPINTAR.
console.log('\n── PARTE 20 · la ✕ del menu de Comunicaciones ──');
{
    const leer = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8').replace(/\r\n/g, '\n');
    const sinCom = (s) => s.split(/\r?\n/).map(l => l.replace(/\/\/.*$/, '')).join('\n')
                           .replace(/<!--[\s\S]*?-->/g, '');
    const cp = sinCom(leer('js/coach/comms/panel.js'));

    const i = cp.indexOf('async function openUnifiedCommsMenu');
    const f = cp.slice(i + 1).search(/\n(?:async )?function \w+\s*\(|\nwindow\.\w+\s*=/);
    const menu = i > -1 ? cp.slice(i, f > -1 ? i + 1 + f : cp.length) : '';
    ok('20·control · la region del menu se acota', menu.length > 1000, 'len=' + menu.length);

    // ⚠️ TERCERA FORMA DE ESTE BOTON. navExit() (ronda 2) y navBack() (v403) se
    // probaron los dos en produccion y NINGUNO valia: los dos dejan al usuario
    // DENTRO del partido. El autor pidio salir del area, no volver un paso.
    ok('20a · [FIX] la ✕ usa navExitToRoles()',
       /onclick="if\(typeof navExitToRoles==='function'\) navExitToRoles\(\)/.test(menu));
    ok('20b · y ya no es navExit() a pelo (forma de la ronda 2)',
       !/onclick="navExit\(\)"/.test(menu));
    ok('20c · ni navBack() con respaldo (forma de v403)',
       !/navCanGoBack\(\)\) navBack\(\)/.test(menu));
    // Ahora los DOS botones se diferencian de verdad, que es lo que no pasaba en
    // v403: alli la ✕ y el "Volver" hacian lo mismo.
    ok('20d · el "← Volver" de abajo SIGUE siendo navBack() (ya no son gemelos)',
       /onclick="navBack\(\)"/.test(menu));
    ok('20e · y el title dice a donde va', /title="Salir al selector de roles"/.test(menu));

    // La primitiva nueva, en el modulo.
    const nav = sinCom(leer('js/core/nav-stack.js'));
    ok('20h · nav-stack expone navExitToRoles', /window\.navExitToRoles = function/.test(nav));
    ok('20i · 🔑 que oculta TAMBIEN los contenedores del campo',
       /\['setup-modal', 'main-header', 'main-container'\]/.test(nav));
    ok('20j · y lleva al selector de roles', /show\(\);/.test(nav));
    ok('20k · ⚠️ oculta el partido, NO lo destruye (display, nunca innerHTML)',
       /el\.style\.display = 'none'/.test(nav) && !/main-container[\s\S]{0,120}innerHTML/.test(nav));
    ok('20l · y si no hubiera selector NO oculta nada (evita la pantalla en negro)',
       /if \(!show\) return window\.navExit\(\);/.test(nav));
    // El procedimiento sale de saGoBackToRoles, que ya lo hacia bien. Si alguien
    // cambia aquel, esta asercion obliga a mirar este.
    ok('20m · mismo procedimiento que el "⏻ Salir" del SuperAdmin',
       /getElementById\('main-container'\)[\s\S]{0,120}display = 'none'/
           .test(sinCom(leer('js/admin/superadmin/superadmin.panel.js'))));
    // Y la via de recuperacion tiene que seguir existiendo, o la salida seria
    // irreversible para un partido en curso.
    ok('20n · ⚠️ el partido se puede recuperar despues',
       /_postMatchReturn/.test(sinCom(leer('js/match/persistence/team-persistence.js'))) &&
       /RECUPERAR PARTIDO/.test(leer('js/core/setup-modal.js')));

    // La via de entrada que explica el sintoma: el post-partido, que es RAIZ y se
    // registra CON el marcador, asi que repintarlo devuelve la pantalla exacta.
    const ai = sinCom(leer('js/core/app-init.js'));
    ok('20f · se entra desde el post-partido, que es RAIZ con su marcador',
       /navRootScreen\('showPostMatchOptions', scoreHome, scoreAway\)/.test(ai) &&
       /openUnifiedCommsMenu\(\)/.test(ai));

    // Contraste: la ✕ del MOTOR sigue siendo navExit y debe seguir siendolo. Ahi
    // debajo no hay pantalla de trabajo, y es lo que el autor eligio en la ronda 7.
    const iM = cp.indexOf('async function _renderUnifiedMessagingView');
    const fM = cp.slice(iM + 1).search(/\n(?:async )?function \w+\s*\(|\nwindow\.\w+\s*=/);
    const motor = iM > -1 ? cp.slice(iM, fM > -1 ? iM + 1 + fM : cp.length) : '';
    ok('20g · la ✕ del MOTOR sigue siendo navExit() (decision distinta, a proposito)',
       /onclick="navExit\(\)"/.test(motor));
}

// ═══════ PARTE 21 · recorridos de la ✕ de Comunicaciones ═══════
console.log('\n── PARTE 21 · recorridos de la ✕ de Comunicaciones ──');
// Sin la primitiva, llamarla lanzaria y el guard MORIRIA sin imprimir el total:
// se quedaria a medias y con exit 1, que parece un fallo de otra cosa. Un guard
// tiene que dar ROJO, no reventar. (Detectado haciendo la prueba de rojo de v404.)
if (typeof build().sb.navExitToRoles !== 'function') {
    ok('21 · nav-stack debe exponer navExitToRoles (sin ella no hay nada que medir)', false);
} else {
    // Modela las TRES capas reales: #main-container es el campo, #setup-modal la
    // capa de modales por encima, y #role-selection-screen el selector. El sintoma
    // del autor es, exactamente, que main-container siga visible.
    function ccSandbox() {
        const t = build();
        t.sb.showPostMatchOptions = function(h, a) {
            t.sb.navRootScreen('showPostMatchOptions', h, a);
            t.pintadas.push('postpartido:' + h + '-' + a);
        };
        // El partido esta en marcha: el campo se ve.
        t.sb.document.getElementById('main-container').style.display = 'flex';
        t.sb.document.getElementById('main-header').style.display = 'flex';
        t.sb.showRoleSelector = function() {
            t.sb.document.getElementById('role-selection-screen').style.display = 'flex';
            t.pintadas.push('selector');
        };
        return t;
    }

    const a = ccSandbox();
    a.sb.showPostMatchOptions(3, 1);
    a.sb.openUnifiedCommsMenu();
    ok('21a · el menu se apila sobre el post-partido', a.sb.navDepth() === 2,
       'profundidad ' + a.sb.navDepth());
    ok('21b · control · con el partido en marcha, el campo SE VE', a.visible('main-container'));

    a.sb.navExitToRoles();
    ok('21c · [FIX] 🔑 la ✕ OCULTA el campo (era justo el sintoma reportado)',
       a.visible('main-container') === false);
    ok('21d · y tambien la cabecera del partido y la capa de modales',
       a.visible('main-header') === false && a.visible('setup-modal') === false);
    ok('21e · [FIX] y deja al usuario en el SELECTOR DE ROLES, no atrapado',
       a.ultima() === 'selector' && a.visible('role-selection-screen'));
    ok('21f · la pila queda vacia', a.sb.navDepth() === 0 && a.sb.navCanGoBack() === false);

    // ── 🔑 AUTO-VERIFICACION: por que fallaron los DOS intentos anteriores ──
    // Esto es lo que ninguna asercion medía hasta ahora: las dos salidas viejas
    // dejan #main-container VISIBLE, o sea el campo de futbol a la vista.
    const b = ccSandbox();
    b.sb.showPostMatchOptions(3, 1);
    b.sb.openUnifiedCommsMenu();
    b.sb.navExit();                       // la forma de la ronda 2
    ok('21g · auto-verificacion: navExit() dejaba el campo VISIBLE',
       b.visible('main-container') === true && b.visible('setup-modal') === false);

    const c = ccSandbox();
    c.sb.showPostMatchOptions(3, 1);
    c.sb.openUnifiedCommsMenu();
    c.sb.navBack();                       // la forma de v403
    ok('21h · auto-verificacion: navBack() tambien (repinta encima, pero sigues en el partido)',
       c.visible('main-container') === true && c.ultima() === 'postpartido:3-1');

    // Degradacion: sin selector NO se oculta nada, para no dejar pantalla en negro.
    const d = build();
    d.sb.document.getElementById('main-container').style.display = 'flex';
    d.sb.openSetupModal();
    d.sb.navExitToRoles();                // sin showRoleSelector definido
    ok('21i · 🔑 sin selector disponible no oculta el campo (nada de pantalla en negro)',
       d.visible('main-container') === true);
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

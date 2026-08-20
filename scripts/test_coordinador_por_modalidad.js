// ═══════════════════════════════════════════════════════════════════════════
//  🎯 EL COORDINADOR TIENE MODALIDAD — v593
// ═══════════════════════════════════════════════════════════════════════════
//  QUÉ PIDIÓ EL AUTOR (implementar.txt, 2026-08-20)
//
//  El rol "Coordinador" era GENÉRICO y en los clubes reales no lo es. Se
//  desglosa en tres: Coordinador de Fútbol 7, de Fútbol 11 y de ambas. Cada
//  uno "absorbe" SÓLO los equipos, informes colectivos, entrenamientos y
//  convocatorias de su modalidad. El Director Deportivo se queda igual: es
//  global y lo ve todo. Y dijo una frase que fija la migración entera:
//  «el coordinador que hay ahora en la app es un coordinador de 7 y 11».
//
//  QUÉ FIJA ESTE GUARD
//
//   1. El predicado vive en UN SOLO SITIO (js/core/utils.js) y todas las
//      puertas preguntan ahí. 🔑 Esta parte es la razón de ser del guard: en
//      este proyecto la misma regla copiada en varios ficheros ya costó
//      v551→v552 (pérdida de roles, el MISMO defecto en cuatro ficheros) y
//      v559 (el semáforo en cuatro copias). Si mañana alguien acota una
//      pestaña nueva a mano, esta parte se pone roja.
//
//   2. FAIL-OPEN. Sin `coordinatorType` —o con una categoría que no se puede
//      clasificar— NO se oculta nada. Es lo que hace que los coordinadores
//      que YA existen sigan viendo su club entero sin migrar ni un dato.
//      Un guard que no fije esto deja la puerta abierta a que un "endurecido"
//      bienintencionado deje mudos a los clubes en producción.
//
//   3. El acotamiento es de la PLAZA, no de la persona: quien coordina el F7
//      en un club y las dos modalidades en otro no puede arrastrar el
//      recorte de un club al otro (mismo eje que la auditoría de v584).
//
//   4. El desplegable de REGISTRARSE ofrece las tres opciones, y el rol que
//      viaja a Firestore SIGUE SIENDO 'coordinator'. ⚠️ Esto es lo que impide
//      que las solicitudes, las aprobaciones del club y del SuperAdmin, las
//      reglas y el recuento de plazas se encuentren con un rol que no
//      conocen. Si alguien "simplifica" mandando 'coordinator_f7' a la base
//      de datos, media app deja de reconocerlo — en silencio.
//
//   5. `ctRenderTree` sin `opts.modalidad` pinta EXACTAMENTE el mismo HTML de
//      siempre. Ese módulo lo comparten cinco pestañas y sus guards comparan
//      el marcado generado.
// ═══════════════════════════════════════════════════════════════════════════

'use strict';

const fs   = require('fs');
const path = require('path');
const vm   = require('vm');

const RAIZ = path.join(__dirname, '..');
let fallos = 0, total = 0;
function ok(nombre, cond, detalle) {
    total++;
    if (cond) { console.log('  ✓ ' + nombre); }
    else { console.log('  ✗ ' + nombre + (detalle !== undefined ? '  → ' + detalle : '')); fallos++; }
}
const leer   = (p) => fs.readFileSync(path.join(RAIZ, p), 'utf8').replace(/\r\n/g, '\n');
const sinCom = (s) => s.split('\n').map(l => l.replace(/\/\/.*$/, '')).join('\n')
                       .replace(/\/\*[\s\S]*?\*\//g, '').replace(/<!--[\s\S]*?-->/g, '');

// ── Sandbox con utils.js ────────────────────────────────────────────────────
const sb = { console: { log() {}, warn() {}, error() {} }, module: { exports: {} } };
sb.window = sb;
vm.createContext(sb);
vm.runInContext(leer('js/core/utils.js'), sb);

const { _cronosCoordScope, _cronosVeCategoria, _cronosCoordScopeLabel,
        _cronosParseRoleValue, _cronosMatchModality } = sb.window;

// ⚠️ COMPROBACIÓN PREVIA. Sin las funciones, las partes de abajo lanzarían y
// el guard moriría SIN imprimir el total — y con exit 0, que parece verde.
// (El mismo defecto ya se pagó en test_nav_stack.js y test_category_tree.js.)
const API = ['_cronosCoordScope', '_cronosVeCategoria', '_cronosCoordScopeLabel',
             '_cronosParseRoleValue'];
const faltan = API.filter(f => typeof sb.window[f] !== 'function');
if (faltan.length) {
    console.log('\n✗ FALTA LA API en js/core/utils.js: ' + faltan.join(', '));
    console.log('\nResultado: 0/' + API.length + ' — el resto del guard no puede ejecutarse.');
    process.exit(1);
}

// ───────────────────────────────────────────────────────────────────────────
console.log('\n── PARTE 1 · _cronosCoordScope: quién queda acotado y quién no ──');
// ───────────────────────────────────────────────────────────────────────────
ok('1a · coordinador de F7 → acotado a f7',
   _cronosCoordScope({ _activeRole: 'coordinator', coordinatorType: 'f7' }) === 'f7');
ok('1b · coordinador de F11 → acotado a f11',
   _cronosCoordScope({ _activeRole: 'coordinator', coordinatorType: 'f11' }) === 'f11');
ok('1c · 🔑 coordinador de AMBAS (f711) → SIN acotar',
   _cronosCoordScope({ _activeRole: 'coordinator', coordinatorType: 'f711' }) === '');
ok('1d · 🔑🔑 coordinador LEGADO sin tipo → SIN acotar (es el caso de todos '
   + 'los que existen hoy: la migración es no hacer nada)',
   _cronosCoordScope({ _activeRole: 'coordinator' }) === '');
ok('1e · 🔑 el DIRECTOR DEPORTIVO nunca se acota, aunque llevase el campo',
   _cronosCoordScope({ _activeRole: 'director', coordinatorType: 'f7' }) === '');
ok('1f · club_admin no se acota',
   _cronosCoordScope({ _activeRole: 'club_admin', coordinatorType: 'f7' }) === '');
ok('1g · superadmin no se acota',
   _cronosCoordScope({ role: 'superadmin', coordinatorType: 'f11' }) === '');
ok('1h · manda el ROL ACTIVO, no el de la raíz (un mismo correo puede ser '
   + 'director en un club y coordinador en otro — v540: la unidad es la PLAZA)',
   _cronosCoordScope({ role: 'coordinator', _activeRole: 'director', coordinatorType: 'f7' }) === '');
ok('1i · null → sin acotar', _cronosCoordScope(null) === '');
ok('1j · tipo inválido → sin acotar (fail-open)',
   _cronosCoordScope({ _activeRole: 'coordinator', coordinatorType: 'futbol-sala' }) === '');
ok('1k · la modalidad se lee también desde allRoles[]',
   _cronosCoordScope({ _activeRole: 'coordinator',
                       allRoles: [{ role: 'user' }, { role: 'coordinator', coordinatorType: 'f11' }] }) === 'f11');

// 🔑 EL ACOTAMIENTO ES DE LA PLAZA. _cronosStaffCoordinatorType se conforma con
// la PRIMERA entrada 'coordinator' de allRoles, y quien coordina en dos clubes
// tiene dos: sin acotar por clubId, la plaza de un club le recortaría el panel
// del otro.
const dosClubes = {
    _activeRole: 'coordinator',
    clubId: 'clubB',
    allRoles: [
        { role: 'coordinator', clubId: 'clubA', coordinatorType: 'f7'  },
        { role: 'coordinator', clubId: 'clubB', coordinatorType: 'f11' },
    ],
};
ok('1l · 🔑🔑 dos plazas de coordinador en dos clubes: manda la del club ACTIVO',
   _cronosCoordScope(dosClubes) === 'f11', _cronosCoordScope(dosClubes));
const dosClubesMixto = {
    _activeRole: 'coordinator',
    clubId: 'clubB',
    allRoles: [
        { role: 'coordinator', clubId: 'clubA', coordinatorType: 'f7' },
        { role: 'coordinator', clubId: 'clubB' },                       // sin tipo → ambas
    ],
};
ok('1m · 🔑🔑 y si la plaza activa NO tiene tipo, no hereda la del otro club: '
   + 've las dos modalidades (acotar de más no se ve, sólo se echa en falta)',
   _cronosCoordScope(dosClubesMixto) === '', _cronosCoordScope(dosClubesMixto));

// ───────────────────────────────────────────────────────────────────────────
console.log('\n── PARTE 2 · _cronosVeCategoria: qué entra en su panel ──');
// ───────────────────────────────────────────────────────────────────────────
const coordF7  = { _activeRole: 'coordinator', coordinatorType: 'f7'  };
const coordF11 = { _activeRole: 'coordinator', coordinatorType: 'f11' };
const coordAmb = { _activeRole: 'coordinator', coordinatorType: 'f711' };
const director = { _activeRole: 'director' };

ok('2a · F7 ve al Alevín',            _cronosVeCategoria(coordF7, 'alevin') === true);
ok('2b · F7 ve al Benjamín',          _cronosVeCategoria(coordF7, 'Benjamín B') === true);
ok('2c · F7 NO ve al Cadete',         _cronosVeCategoria(coordF7, 'cadete') === false);
ok('2d · F7 NO ve al Juvenil',        _cronosVeCategoria(coordF7, 'Juvenil A') === false);
ok('2e · F11 ve al Infantil',         _cronosVeCategoria(coordF11, 'infantil') === true);
ok('2f · F11 NO ve al Prebenjamín',   _cronosVeCategoria(coordF11, 'prebenjamin') === false);
ok('2g · 🔑 el de AMBAS lo ve todo',
   _cronosVeCategoria(coordAmb, 'alevin') && _cronosVeCategoria(coordAmb, 'juvenil'));
ok('2h · 🔑 el DIRECTOR lo ve todo (rol global, no se toca — lo pidió así)',
   _cronosVeCategoria(director, 'alevin') && _cronosVeCategoria(director, 'regional'));
ok('2i · 🔑🔑 FAIL-OPEN: categoría que no se puede clasificar → SE VE. Ocultar '
   + 'de más no se nota; ocultar de menos se ve y se corrige.',
   _cronosVeCategoria(coordF7, 'CategoríaRara') === true);
ok('2j · categoría vacía → se ve', _cronosVeCategoria(coordF7, '') === true);

// Las dos femeninas, que en este proyecto ya han sido trampa (v511):
// FUTureFEM es F11 desde v537 y Regional FEM entra por 'regional'.
ok('2k · ⚠️ FUTureFEM es F11 (v537), así que la lleva el coordinador de F11',
   _cronosMatchModality('futurefem') === 'f11' &&
   _cronosVeCategoria(coordF11, 'futurefem') === true &&
   _cronosVeCategoria(coordF7,  'futurefem') === false);
ok('2l · ⚠️ Regional FEM es F11',
   _cronosVeCategoria(coordF11, 'regional_fem') === true &&
   _cronosVeCategoria(coordF7,  'regional_fem') === false);

// El `mode` explícito manda sobre la categoría, igual que en el resto del
// proyecto: un juvenil PUEDE jugar un F7 (v561).
ok('2m · el modo explícito del partido manda sobre la etiqueta de categoría',
   _cronosVeCategoria(coordF7, 'juvenil', 'f7') === true &&
   _cronosVeCategoria(coordF11, 'juvenil', 'f7') === false);

ok('2n · etiquetas legibles del acotamiento',
   _cronosCoordScopeLabel('f7') === 'Fútbol 7' &&
   _cronosCoordScopeLabel('f11') === 'Fútbol 11' &&
   _cronosCoordScopeLabel('') === '');

// ───────────────────────────────────────────────────────────────────────────
console.log('\n── PARTE 3 · el desplegable de REGISTRARSE y su normalización ──');
// ───────────────────────────────────────────────────────────────────────────
const HTML = leer('index.html');
const selRol = (HTML.match(/<select id="auth-role"[\s\S]*?<\/select>/) || [''])[0];

ok('3a · el desplegable ofrece Coordinador de Fútbol 7',
   /value="coordinator_f7"[^>]*>[^<]*F[uú]tbol 7</.test(selRol));
ok('3b · … de Fútbol 11',
   /value="coordinator_f11"[^>]*>[^<]*F[uú]tbol 11</.test(selRol));
ok('3c · … y de Fútbol 7 y Fútbol 11',
   /value="coordinator_f711"/.test(selRol));
ok('3d · ya NO queda la opción genérica "coordinator" a secas (era justo lo '
   + 'que el autor pidió desglosar)',
   !/value="coordinator"/.test(selRol));
ok('3e · el Director Deportivo sigue siendo UNA opción global, sin modalidad',
   /value="director"/.test(selRol) && !/value="director_f/.test(selRol));

// 🔑 LA PARTE QUE PROTEGE MEDIA APP: el rol que sale de aquí hacia Firestore
// tiene que seguir siendo 'coordinator'.
ok('3f · 🔑🔑 _cronosParseRoleValue parte el valor en rol + modalidad',
   JSON.stringify(_cronosParseRoleValue('coordinator_f7')) ===
   JSON.stringify({ role: 'coordinator', coordinatorType: 'f7' }));
ok('3g · … también f11 y f711',
   _cronosParseRoleValue('coordinator_f11').coordinatorType === 'f11' &&
   _cronosParseRoleValue('coordinator_f711').coordinatorType === 'f711');
ok('3h · 🔑 el ROL nunca sale con sufijo: las solicitudes, las aprobaciones, '
   + 'las reglas y el recuento de plazas siguen viendo "coordinator"',
   ['coordinator_f7', 'coordinator_f11', 'coordinator_f711']
       .every(v => _cronosParseRoleValue(v).role === 'coordinator'));
ok('3i · el valor legado "coordinator" a secas sigue siendo un rol válido, '
   + 'sin modalidad (la pregunta el selector de respaldo)',
   JSON.stringify(_cronosParseRoleValue('coordinator')) ===
   JSON.stringify({ role: 'coordinator', coordinatorType: '' }));
ok('3j · los demás roles pasan intactos',
   _cronosParseRoleValue('director').role === 'director' &&
   _cronosParseRoleValue('user').role === 'user' &&
   _cronosParseRoleValue('parent').coordinatorType === '');
ok('3k · sufijo inventado → rol válido y modalidad vacía (no se inventa nada)',
   _cronosParseRoleValue('coordinator_futsal').role === 'coordinator' &&
   _cronosParseRoleValue('coordinator_futsal').coordinatorType === '');

const AUTH = sinCom(leer('js/services/auth.js'));
ok('3l · 🔑 auth.js normaliza el valor del desplegable en la ÚNICA puerta de '
   + 'entrada del registro, en vez de comparar el sufijo por ahí suelto',
   /_cronosParseRoleValue/.test(AUTH) &&
   /const requestedRole\s*=\s*_roleParsed\.role/.test(AUTH));
ok('3m · … y la modalidad elegida en el desplegable manda sobre el selector '
   + 'suelto de respaldo',
   /_coordType\s*=\s*_roleParsed\.coordinatorType\s*\|\|/.test(AUTH));
ok('3n · ⚠️ el bloqueo de roles bajo un ENTE INDIVIDUAL cubre las tres '
   + 'opciones (una lista cerrada las habría dejado seleccionables)',
   /startsWith\('coordinator'\)/.test(AUTH));

// ───────────────────────────────────────────────────────────────────────────
console.log('\n── PARTE 4 · ctRenderTree: el árbol de UNA modalidad ──');
// ───────────────────────────────────────────────────────────────────────────
const sbT = { console: { log() {}, warn() {}, error() {} } };
sbT.window = sbT;
vm.createContext(sbT);
vm.runInContext(leer('js/core/utils.js'), sbT);          // aporta _cronosMatchModality
vm.runInContext(leer('js/admin/shared/category-tree.js'), sbT);

const items = [
    { cat: 'alevin',   sub: 'A' },
    { cat: 'cadete',   sub: 'B' },
    { cat: 'juvenil',  sub: 'A' },
];
const opciones = { items, getCat: (x) => x.cat, getSub: (x) => x.sub,
                   renderLeaf: () => '<i></i>' };

const htmlSinFiltro = sbT.window.ctRenderTree(opciones);
const htmlF7  = sbT.window.ctRenderTree(Object.assign({}, opciones, { modalidad: 'f7' }));
const htmlF11 = sbT.window.ctRenderTree(Object.assign({}, opciones, { modalidad: 'f11' }));

ok('4a · ⚠️⚠️ SIN opts.modalidad el marcado es BYTE A BYTE el de siempre '
   + '(cinco pestañas comparten este módulo y sus guards comparan el HTML)',
   htmlSinFiltro === sbT.window.ctRenderTree(Object.assign({}, opciones, { modalidad: '' })));
ok('4b · sin filtro salen las 9 categorías del catálogo',
   (htmlSinFiltro.match(/ct-tree-cat"/g) || []).length === 9,
   (htmlSinFiltro.match(/ct-tree-cat"/g) || []).length);
ok('4c · 🔑 con modalidad f7 el árbol NO trae Cadete ni Juvenil: al '
   + 'coordinador de F7 no se le enseñan las ramas de la otra modalidad a cero',
   !/>Cadete</.test(htmlF7) && !/>Juvenil</.test(htmlF7));
ok('4d · … y sí trae las suyas',
   /Prebenjam/.test(htmlF7) && /Benjam/.test(htmlF7) && /Alev/.test(htmlF7));
ok('4e · con modalidad f11 pasa lo simétrico',
   !/>Alev[ií]n</.test(htmlF11) && /Cadete/.test(htmlF11) && /Juvenil/.test(htmlF11));
ok('4f · ⚠️ FUTureFEM y Regional FEM van con el árbol de F11',
   /FUTureFEM/.test(htmlF11) && /Regional FEM/.test(htmlF11) &&
   !/FUTureFEM/.test(htmlF7));
ok('4g · una modalidad desconocida no filtra nada (fail-open)',
   sbT.window.ctRenderTree(Object.assign({}, opciones, { modalidad: 'sala' })) === htmlSinFiltro);

// ───────────────────────────────────────────────────────────────────────────
console.log('\n── PARTE 5 · 🔑🔑🔑 TODAS las puertas preguntan al MISMO sitio ──');
// ───────────────────────────────────────────────────────────────────────────
//  Ésta es la parte que de verdad importa. El autor nombró cuatro cosas —
//  equipos, informes colectivos, entrenamientos y convocatorias— y cada una
//  se pinta en un fichero distinto. Con la regla copiada, bastaría con que
//  una copia se quedase atrás para que un coordinador viera lo que no es suyo
//  sin que nadie se enterase. Ya pasó en v551→v552 y en v559.
const PUERTAS = [
    ['Convocatorias y Entrenamientos', 'js/coach/reports/events-tab.js'],
    ['Informes colectivos',            'js/coach/reports/reports-tab.js'],
    ['Equipos (Asistencia) y tablero', 'js/coach/reports/club-reports.js'],
    ['Partidos terminados',            'js/coach/reports/finished-matches-tab.js'],
];
PUERTAS.forEach(([etiqueta, fichero], i) => {
    const src = sinCom(leer(fichero));
    ok('5' + 'abcd'[i] + ' · ' + etiqueta + ' pregunta al predicado compartido',
       /_cronosCoordScope|_cronosVeCategoria/.test(src), fichero);
});
ok('5e · el enrutado de avisos del entrenador reutiliza el resolutor de staff '
   + 'que ya existía (Pieza 2), en vez de estrenar una segunda regla',
   /_cronosResolveStaffForMatch/.test(sinCom(leer('js/coach/comms/contact-manager.js'))));

// Y que nadie reescriba la lista de qué es F7 y qué es F11 en estos ficheros.
const LISTA_PROPIA = /\[\s*'prebenjamin'[\s\S]{0,120}'alevin'/;
PUERTAS.forEach(([etiqueta, fichero], i) => {
    ok('5' + 'fghi'[i] + ' · ⚠️ ' + etiqueta + ' NO reescribe su propia lista de '
       + 'categorías por modalidad (eso vive en _cronosMatchModality)',
       !LISTA_PROPIA.test(sinCom(leer(fichero))), fichero);
});

// ───────────────────────────────────────────────────────────────────────────
console.log('\n── PARTE 6 · el Director Deportivo NO se toca ──');
// ───────────────────────────────────────────────────────────────────────────
//  Requisito literal del autor: «Director Deportivo: se mantiene tal y como
//  está; es un rol global que absorbe y visualiza ambas categorías sin
//  distinción». Si alguien aplicase el acotamiento por `role` en vez de por
//  el rol ACTIVO, o extendiera el desglose al director, esto se pone rojo.
const dirs = [
    { _activeRole: 'director' },
    { _activeRole: 'director', clubId: 'c1',
      allRoles: [{ role: 'coordinator', clubId: 'c1', coordinatorType: 'f7' },
                 { role: 'director',    clubId: 'c1' }] },
];
ok('6a · el director ve F7 y F11 aunque además tenga una plaza de coordinador '
   + 'de F7 en el mismo club',
   dirs.every(d => _cronosVeCategoria(d, 'alevin') && _cronosVeCategoria(d, 'juvenil')));
ok('6b · y su alcance calculado es "sin acotar"',
   dirs.every(d => _cronosCoordScope(d) === ''));

// ───────────────────────────────────────────────────────────────────────────
console.log('\n' + (fallos === 0
    ? '✅ TODO OK (' + total + ' comprobaciones)'
    : '❌ ' + fallos + ' FALLOS de ' + total));
process.exit(fallos === 0 ? 0 : 1);

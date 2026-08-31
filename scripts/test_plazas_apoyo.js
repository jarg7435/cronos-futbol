// ════════════════════════════════════════════════════════════════════
//  GUARD · PLAZAS DE APOYO (jugadores invitados de otra categoría)
//  2026-08-12 · implementar.txt
// ════════════════════════════════════════════════════════════════════
//  Lo que fija, en orden de gravedad:
//
//  1. 🔑🔑🔑 LA LISTA BLANCA DE LO QUE SE PUBLICA. La plantilla vive en el
//     MISMO documento de Firestore que cronos_email_config, o sea los correos
//     y teléfonos de todos los padres. Por eso la copia que ven los demás
//     entrenadores se construye campo a campo. Si alguien la cambia por un
//     spread "para simplificar", cualquier campo futuro de la plantilla se
//     publicaría solo. La PARTE 1 lo mide con un jugador contaminado.
//
//  2. 🔑🔑 EL INVITADO CONSERVA SU FICHA. _cronosGeneratePlayerId construye
//     el código con la categoría DEL ENTRENADOR QUE MIRA más el número de
//     fila, y openRosterManager lo regenera en cada apertura. Aplicado a un
//     invitado, el 'CDA07' del cadete se volvería 'JVA19' y el vínculo con su
//     equipo de origen se perdería sin ningún error.
//
//  3. 🔑🔑 EL ACUMULADO NO PUEDE AGRUPAR AL INVITADO POR DORSAL. Juega con un
//     dorsal libre del anfitrión que ES DE OTRO en los demás partidos.
//
//  4. 🔑 LAS COLABORACIONES NO SUMAN EN EL TOTAL DEL EQUIPO DE ORIGEN.
// ════════════════════════════════════════════════════════════════════
const fs = require('fs');
const vm = require('vm');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const leer = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8');
const sinCom = (s) => s.split(/\r?\n/).map(l => l.replace(/\/\/.*$/, '')).join('\n');

let FALLOS = 0;
function ok(t, cond, extra) {
    console.log((cond ? 'PASS ' : 'FAIL ') + t + (cond || extra === undefined ? '' : '   → ' + JSON.stringify(extra)));
    if (!cond) FALLOS++;
}

// ⚠️ CADA PARTE VA EN SU PROPIA RED. Sin esto, la primera llamada a algo que
// todavía no existe —ctAccumulateGuestStats, un fichero sin crear— LANZA y
// mata el proceso: el guard sale en rojo, sí, pero deja de contar y esconde
// todo lo que venía detrás. En el red-check contra el código anterior, este
// mismo guard se paraba en la PARTE 5 y las partes 6 a 10 no llegaban a
// medirse. Es la misma familia que "un guard de regex no puede ver un fichero
// que no compila", ya documentada en test_nav_stack.js.
function parte(nombre, fn) {
    console.log('\n── ' + nombre + ' ──');
    try { fn(); }
    catch (e) {
        FALLOS++;
        console.log('FAIL ' + nombre + ' · LANZÓ: ' + (e && e.message ? e.message : e));
    }
}

// ── Sandbox con category-tree.js + team-rosters.js ──────────────────
function build() {
    const sb = { console, setTimeout, JSON, Date, Math, String, Number, Array, Object };
    sb.window = sb;
    sb.document = { getElementById: () => null, querySelectorAll: () => [] };
    vm.createContext(sb);
    vm.runInContext(leer('js/admin/shared/category-tree.js'), sb);
    // team-rosters.js usa `await import(...)` sólo dentro de las funciones de
    // red, que este guard no llama: cargarlo es seguro y da _recortar.
    vm.runInContext(leer('js/roster/team-rosters.js'), sb);
    return sb;
}

// ═══════ PARTE 1 · la lista blanca de lo que se publica ═══════
parte('PARTE 1 · 🔑 privacidad: qué sale de la plantilla', () => {
    const sb = build();
    const recortar = sb._cronosTeamRosterTrim;
    ok('1a · el módulo expone el recorte', typeof recortar === 'function');

    // Un jugador con basura sensible pegada, como la que podría acabar en la
    // plantilla el día de mañana.
    const sucio = [{
        id: 'CDA07', number: 7, name: 'Marcos', surname: 'Ruiz', alias: 'Marcos',
        email: 'padre@ejemplo.com', telefono: '600123456', dni: '00000000X',
        direccion: 'Calle Falsa 123', notasMedicas: 'alergia'
    }];
    const salida = recortar(sucio);
    ok('1b · publica exactamente un jugador', salida.length === 1, salida);

    const claves = Object.keys(salida[0]).sort();
    ok('1c · 🔑🔑🔑 SÓLO cuatro campos: ficha, dorsal, nombre y alias',
       JSON.stringify(claves) === JSON.stringify(['alias', 'dorsal', 'ficha', 'nombre']), claves);

    const fuga = ['email', 'telefono', 'dni', 'direccion', 'notasMedicas', 'surname']
        .filter(k => k in salida[0]);
    ok('1d · 🔑🔑🔑 NINGÚN dato sensible se cuela', fuga.length === 0, fuga);

    ok('1e · la ficha y el dorsal viajan como texto',
       salida[0].ficha === 'CDA07' && salida[0].dorsal === '7', salida[0]);

    // Una fila vacía de la plantilla no se publica: llenaría el selector ajeno
    // de "Sin nombre" imposibles de elegir.
    ok('1f · las filas vacías no se publican',
       recortar([{ id: 'CDA09', number: 9, name: '', alias: '' }]).length === 0);

    // El censo de fuente: si alguien sustituye el recorte por un spread, esto
    // salta aunque el resto del guard siguiera verde con datos de juguete.
    const src = sinCom(leer('js/roster/team-rosters.js'));
    const cuerpo = src.slice(src.indexOf('function _recortar'), src.indexOf('window.cronosPublishTeamRoster'));
    ok('1g · 🔑 el recorte NO usa spread del jugador', !/\.\.\.p\b/.test(cuerpo), cuerpo.match(/\.\.\.\w+/g));
});

// ═══════ PARTE 2 · los campos de origen en el informe ═══════
parte('PARTE 2 · cronosGuestFields', () => {
    const sb = build();
    const gf = sb.cronosGuestFields;
    ok('2a · existe', typeof gf === 'function');
    ok('2b · 🔑 un jugador de la casa NO añade ni un campo al informe',
       JSON.stringify(gf({ number: 7, alias: 'Ana' })) === '{}', gf({ number: 7 }));
    ok('2c · y null/undefined tampoco revientan',
       JSON.stringify(gf(null)) === '{}' && JSON.stringify(gf(undefined)) === '{}');

    const g = gf({ isGuest: true, originTeamId: 'club__cadete__a', originCategory: 'cadete',
                   originSubcategory: 'A', originPlayerId: 'CDA07' });
    ok('2d · el invitado arrastra sus cinco campos', Object.keys(g).length === 5, Object.keys(g));
    ok('2e · 🔑 NINGÚN valor es undefined (un undefined LANZA en Firestore)',
       Object.values(gf({ isGuest: true })).every(v => v !== undefined),
       gf({ isGuest: true }));
});

// ═══════ PARTE 3 · la ficha del invitado no se regenera ═══════
parte('PARTE 3 · 🔑🔑 openRosterManager respeta la ficha de origen', () => {
    const src = sinCom(leer('js/core/staff-and-comms.js'));
    const bloque = src.slice(src.indexOf('roster[mode].forEach((p, i) =>'),
                             src.indexOf("localStorage.setItem('cronos_master_roster'"));
    ok('3a · la regeneración de IDs existe todavía', /_cronosGeneratePlayerId\(i\)/.test(bloque));
    ok('3b · 🔑🔑 y SALTA las filas de apoyo y las invitadas',
       /if\s*\(i\s*>=\s*limit\s*\|\|\s*p\.isGuest\s*\|\|\s*p\.isSupport\)\s*return;/.test(bloque),
       bloque.slice(0, 200));

    // La recogida de filas es el otro punto donde el origen se perdía.
    ok('3c · 🔑 la recogida de filas conserva los campos de origen',
       /originPlayerId\s*=\s*row\.dataset\.originFicha/.test(src) &&
       /base\.isGuest\s*=\s*true/.test(src));
    ok('3d · y saveMasterRoster usa ESA recogida, no una copia suya',
       /_cronosHarvestRosterRows\(\)/.test(sinCom(leer('js/ai/import.js'))));

    // El tope de 7 y la base intacta.
    ok('3e · la base sigue siendo 18 (F7) y 25 (F11)',
       /CRONOS_ROSTER_BASE\s*=\s*\{\s*f7:\s*18,\s*f11:\s*25\s*\}/.test(src));
    ok('3f · y el tope de apoyo es 7', /CRONOS_ROSTER_EXTRA\s*=\s*7/.test(src));
});

// ═══════ PARTE 4 · los campos sobreviven al arranque del partido ═══════
parte('PARTE 4 · 🔑 spawnInitialPlayers no los tira', () => {
    const src = sinCom(leer('js/core/event-listeners.js'));
    const bloque = src.slice(src.indexOf('const playerObj = {'), src.indexOf('players.push(playerObj);'));
    ['isGuest', 'originTeamId', 'originCategory', 'originSubcategory', 'originPlayerId']
        .forEach(campo => {
            ok('4·' + campo + ' · viaja de la convocatoria al partido',
               new RegExp(campo + ':').test(bloque));
        });
});

// ═══════ PARTE 5 · el acumulador no funde al invitado con el dorsal ajeno ═══════
parte('PARTE 5 · 🔑🔑 agrupación por ficha, no por dorsal', () => {
    const sb = build();
    // El 7 del juvenil y un cadete invitado que TAMBIÉN lleva el 7.
    const partidos = [{
        category: 'juvenil', subcategory: 'A',
        players: [
            { playerNumber: '7', playerAlias: 'Iker', minutesPlayed: '90:00', goals: 2 },
            { playerNumber: '7', playerAlias: 'Marcos', minutesPlayed: '30:00', goals: 1,
              isGuest: true, originPlayerId: 'CDA07', originCategory: 'cadete', originSubcategory: 'A' },
        ]
    }];
    const filas = sb.ctAccumulatePlayerStats(partidos);
    ok('5a · 🔑🔑 salen DOS filas, no una fundida', filas.length === 2, filas);
    const iker = filas.filter(f => f.alias === 'Iker')[0];
    const marcos = filas.filter(f => f.alias === 'Marcos')[0];
    ok('5b · el titular conserva sus 90 minutos y 2 goles',
       iker && iker.minutes === 90 && iker.goals === 2, iker);
    ok('5c · y el invitado los suyos, sin mezclarse',
       marcos && marcos.minutes === 30 && marcos.goals === 1, marcos);

    // Sin la ficha (informe antiguo) se mantiene el comportamiento de siempre.
    const viejos = [{ category: 'juvenil', subcategory: 'A', players: [
        { playerNumber: '7', playerAlias: 'Iker', minutesPlayed: '90:00' },
        { playerNumber: '7', playerAlias: 'Iker', minutesPlayed: '45:00' },
    ] }];
    ok('5d · 🔑 el histórico sin ficha sigue agrupándose por dorsal',
       sb.ctAccumulatePlayerStats(viejos).length === 1);
});

// ═══════ PARTE 6 · las colaboraciones vuelven a su categoría ═══════
parte('PARTE 6 · ctAccumulateGuestStats', () => {
    const sb = build();
    const partidos = [
        // Dos partidos del juvenil, en los que colabora un cadete.
        { category: 'juvenil', subcategory: 'A', players: [
            { playerNumber: '7', playerAlias: 'Iker', minutesPlayed: '90:00', goals: 1 },
            { playerNumber: '15', playerAlias: 'Marcos', minutesPlayed: '30:00', goals: 1,
              isGuest: true, originPlayerId: 'CDA07', originCategory: 'cadete', originSubcategory: 'A' },
        ] },
        { category: 'juvenil', subcategory: 'A', players: [
            { playerNumber: '15', playerAlias: 'Marcos', minutesPlayed: '20:00', goals: 0,
              isGuest: true, originPlayerId: 'CDA07', originCategory: 'cadete', originSubcategory: 'A' },
        ] },
        // Y uno del propio cadete, que NO es colaboración.
        { category: 'cadete', subcategory: 'A', players: [
            { playerNumber: '7', playerAlias: 'Marcos', minutesPlayed: '80:00', goals: 3 },
        ] },
    ];

    const inv = sb.ctAccumulateGuestStats(partidos, 'cadete', 'A');
    ok('6a · el cadete A recupera UNA fila de colaboración', inv.length === 1, inv);
    ok('6b · 🔑 acumula los DOS partidos cedidos y sólo ésos',
       inv[0] && inv[0].pj === 2 && inv[0].minutes === 50 && inv[0].goals === 1, inv[0]);
    ok('6c · y dice con quién colaboró',
       inv[0] && inv[0].hosts.length === 1 && /Juvenil/.test(inv[0].hosts[0]), inv[0] && inv[0].hosts);
    ok('6d · conserva la ficha de origen', inv[0] && inv[0].ficha === 'CDA07', inv[0]);

    ok('6e · 🔑 el juvenil NO ve colaboraciones ajenas en su rama',
       sb.ctAccumulateGuestStats(partidos, 'juvenil', 'A').length === 0);
    ok('6f · ni la subcategoría equivocada del mismo cadete',
       sb.ctAccumulateGuestStats(partidos, 'cadete', 'B').length === 0);

    // El partido propio del cadete sigue contando en su tabla NORMAL.
    const propias = sb.ctAccumulatePlayerStats([partidos[2]]);
    ok('6g · 🔑 y su partido propio sigue en la fila normal, sin duplicarse',
       propias.length === 1 && propias[0].minutes === 80 && propias[0].goals === 3, propias);
});

// ═══════ PARTE 7 · la tabla: fila supletoria de otro color ═══════
parte('PARTE 7 · 🔑 la fila supletoria no contamina el total', () => {
    const sb = build();
    const normales = [{ number: '7', alias: 'Marcos', pj: 1, minutes: 80, goals: 3,
                        yellow: 0, red: 0, injuries: 0, seconds: 4800 }];
    const invitadas = [{ ficha: 'CDA07', number: '', alias: 'Marcos', pj: 2, minutes: 50,
                         goals: 1, yellow: 1, red: 0, injuries: 0, hosts: ['Juvenil A'] }];

    const conInv = sb.ctRenderStatsTable(normales, { matchCount: 1, guestRows: invitadas });
    ok('7a · pinta la fila de colaboración', /ct-stats-guest/.test(conInv));
    ok('7b · con la etiqueta del equipo anfitrión', /Juvenil A/.test(conInv));
    ok('7c · y avisa de que no suma', /no suman en el total/.test(conInv));

    // 🔑 EL TOTAL. Los 3 goles del cadete en su equipo, NO 4.
    const tfoot = conInv.slice(conInv.indexOf('<tfoot>'));
    ok('7d · 🔑🔑 el total del equipo NO incluye los goles cedidos (3, no 4)',
       />3</.test(tfoot) && !/>4</.test(tfoot), tfoot);
    ok('7e · ni las tarjetas de la cesión (0 amarillas, no 1)',
       (tfoot.match(/<td>0<\/td>/g) || []).length >= 2, tfoot);

    // Sin colaboraciones el marcado tiene que ser EL DE SIEMPRE.
    // ⚠️ SE MIDE EL MARCADO, NO LA HOJA DE ESTILOS. ctRenderStatsTable
    // devuelve CT_STATS_CSS + tabla, y ese CSS contiene literalmente
    // `.ct-stats-guest`: sin quitar el <style>, esta aserción daba rojo
    // midiendo la hoja de estilos y no el marcado — exactamente la trampa que
    // ya está documentada en test_category_tree.js (5d/5f) y en
    // test_nav_stack.js. La primera versión de este guard cayó en ella.
    const marcado = (h) => h.replace(/<style>[\s\S]*?<\/style>/g, '');
    const sinInv = sb.ctRenderStatsTable(normales, { matchCount: 1 });
    ok('7f · 🔑 sin colaboraciones el marcado es idéntico al de siempre',
       !/ct-stats-guest/.test(marcado(sinInv)) &&
       sinInv === sb.ctRenderStatsTable(normales, { matchCount: 1, guestRows: [] }));

    // Un filial SIN partidos propios pero CON cesiones tiene que ver su tabla.
    const soloInv = sb.ctRenderStatsTable([], { matchCount: 0, guestRows: invitadas });
    ok('7g · 🔑 un equipo sin partidos propios pero con cesiones SÍ ve su tabla',
       /ct-stats-guest/.test(soloInv) && !/no hay acumulado de temporada/.test(soloInv));
    ok('7h · y sin ninguna de las dos cosas sigue diciendo que no hay nada',
       /no hay acumulado de temporada/.test(sb.ctRenderStatsTable([], {})));
});

// ═══════ PARTE 8 · el árbol pregunta por las ramas vacías ═══════
parte('PARTE 8 · alwaysSubHeader', () => {
    const sb = build();
    let vistas = [];
    const html = sb.ctRenderTree({
        items: [], getCat: i => i.c, getSub: i => i.s,
        renderLeaf: () => '', alwaysSubHeader: true,
        renderSubHeader: (arr, catId, subId) => { vistas.push(catId + '|' + subId); return ''; },
    });
    ok('8a · 🔑 con alwaysSubHeader se pregunta por TODAS las ramas (9×3)',
       vistas.length === 27, vistas.length);

    // Y sin la opción, el comportamiento de siempre: cero llamadas si no hay nada.
    vistas = [];
    sb.ctRenderTree({
        items: [], getCat: i => i.c, getSub: i => i.s, renderLeaf: () => '',
        renderSubHeader: (arr, catId, subId) => { vistas.push(catId); return ''; },
    });
    ok('8b · 🔑 y sin la opción NO se llama ni una vez (comportamiento previo)',
       vistas.length === 0, vistas.length);
});

// ═══════ PARTE 9 · las reglas de Firestore ═══════
parte('PARTE 9 · firestore.rules', () => {
    const rules = leer('firestore.rules');
    // ⚠️ SE COMPRUEBA EL -1 A PROPÓSITO. La primera versión hacía
    // `rules.slice(rules.indexOf(...))` y medía `cuerpo.length > 0`: con la
    // regla AUSENTE, indexOf da -1, slice(-1) devuelve el último carácter del
    // fichero y la aserción daba VERDE sin que la colección existiera. Lo cazó
    // el red-check contra el código anterior — un falso verde que habría
    // dejado la parte 9 entera sin vigilar.
    const ini = rules.indexOf('match /clubs/{clubId}/team_rosters/{teamId}');
    ok('9a · la colección de fichas existe', ini !== -1, ini);
    const bloque = ini === -1 ? '' : rules.slice(ini);
    const cuerpo = bloque.slice(0, bloque.indexOf('\n    }') + 6);
    ok('9b · la lee cualquier miembro autorizado del club',
       /sameClubAsDoc\(clubId\)/.test(cuerpo) && /userDocClubId\(clubId\)/.test(cuerpo));
    ok('9c · 🔑 sólo el dueño la crea',
       /allow create:[\s\S]{0,200}request\.auth\.uid == request\.resource\.data\.get\('coachUid'/.test(cuerpo));
    ok('9d · 🔑🔑 el update compara contra lo GUARDADO, no sólo contra el payload',
       /allow update:[\s\S]{0,260}request\.auth\.uid == resource\.data\.get\('coachUid'/.test(cuerpo),
       cuerpo.slice(cuerpo.indexOf('allow update'), cuerpo.indexOf('allow delete')));

    // ⚠️ Y la regla de la plantilla original NO se ha tocado: sigue siendo
    // sólo-el-dueño. Es lo que impide que el directorio de padres se publique.
    ok('9e · 🔑🔑🔑 users/{uid}/cronos_data SIGUE cerrada a su dueño',
       /match \/users\/\{userId\}\/cronos_data\/\{docId\} \{\s*\n\s*allow read, write: if isAuth\(\) && request\.auth\.uid == userId;/.test(rules));
});

// ═══════ PARTE 10 · los módulos se cargan ═══════
parte('PARTE 10 · carga', () => {
    const idx = leer('index.html');
    ok('10a · team-rosters.js está enlazado', /js\/roster\/team-rosters\.js/.test(idx));
    ok('10b · guest-picker.js también', /js\/roster\/guest-picker\.js/.test(idx));
    const sw = leer('sw.js');
    ok('10c · 🔑 y los dos están en el precache del service worker',
       /js\/roster\/team-rosters\.js/.test(sw) && /js\/roster\/guest-picker\.js/.test(sw));
});

parte('PARTE 11 · 🔑🔑 la modalidad cuando #setup-mode ya no existe', () => {
    // 💥 EL FALLO QUE REPORTÓ EL AUTOR (2026-08-12):
    //   Uncaught TypeError: Cannot read properties of null (reading 'value')
    //   at openRosterManager (staff-and-comms.js:253)
    // El <select id="setup-mode"> vive DENTRO de #setup-modal, y
    // openRosterManager reescribe ese modal: al repintar DESDE la propia
    // pantalla de plantilla, el elemento ya no está.
    const staff = leer('js/core/staff-and-comms.js');
    const sinC = sinCom(staff);

    ok('11a · existe un resolutor único de modalidad',
       /window\.cronosActiveMode\s*=\s*function/.test(sinC));

    // 🔑 NADIE en la ruta de plantilla puede volver a leer .value directo.
    const crudas = (sinC.match(/getElementById\('setup-mode'\)\.value/g) || []);
    ok('11b · 🔑🔑 NADIE lee .value de #setup-mode sin protección',
       crudas.length === 0, crudas);

    // Y los tres llamadores usan el resolutor.
    ok('11c · openRosterManager y las plazas de apoyo usan el resolutor',
       (sinC.match(/cronosActiveMode\(\)/g) || []).length >= 3,
       (sinC.match(/cronosActiveMode\(\)/g) || []).length);
    ok('11d · el selector de invitado también',
       /cronosActiveMode\(\)/.test(sinCom(leer('js/roster/guest-picker.js'))));
    // 🚫 v647 · 11e VIGILABA UN CAMINO QUE YA NO EXISTE. La importación por
    // foto (`showRosterPreview`) caía a 'f11' en silencio y por eso se la
    // obligó a pasar por `cronosActiveMode()`. La cadena entera de OCR se
    // borró por protección de datos, así que la asercion se da la vuelta:
    // ahora lo que se exige es que ese camino NO vuelva. Si reapareciera,
    // volvería con su defecto de modo, que es lo que costó encontrar.
    ok('11e · 🤫 y la importación por foto ya no existe (no puede caer a f11)',
       !/showRosterPreview/.test(sinCom(leer('js/ai/import.js'))),
       'si vuelve, tiene que volver pasando por cronosActiveMode()');

    // Comportamiento real: sin el elemento en el DOM, no lanza y recuerda.
    const sb = { console, document: { getElementById: () => null }, window: null };
    sb.window = sb;
    vm.createContext(sb);
    vm.runInContext(staff.slice(staff.indexOf('window._cronosLastRosterMode = null;'),
                                staff.indexOf('window._cronosGeneratePlayerId')), sb);
    let valor = null, lanzo = false;
    try { valor = sb.window.cronosActiveMode(); } catch (e) { lanzo = true; }
    ok('11f · 🔑 sin el <select> en el DOM NO lanza', !lanzo);
    ok('11g · y cae a f7 cuando no hay nada más', valor === 'f7', valor);

    // Con el select presente lo lee y lo RECUERDA para el repintado siguiente.
    sb.document.getElementById = () => ({ value: 'f11' });
    ok('11h · con el <select> presente lee f11', sb.window.cronosActiveMode() === 'f11');
    sb.document.getElementById = () => null;
    ok('11i · 🔑🔑 y al desaparecer el <select> RECUERDA f11, no vuelve a f7',
       sb.window.cronosActiveMode() === 'f11', sb.window.cronosActiveMode());
});

parte('PARTE 12 · 🔑 sólo se convoca HACIA ABAJO en el escalafón', () => {
    const sb = build();
    const puede = sb.cronosPuedeConvocarDe;
    ok('12a · existe la regla de jerarquía', typeof puede === 'function');

    // El ejemplo LITERAL del autor: desde Juvenil B.
    ok('12b · 🔑 Juvenil B SÍ puede tirar de Juvenil C',
       puede('juvenil', 'B', 'juvenil', 'C') === true);
    ok('12c · 🔑🔑 pero NO del Juvenil A (hacia el lado/arriba, jamás)',
       puede('juvenil', 'B', 'juvenil', 'A') === false);
    ok('12d · ni de otro Juvenil B', puede('juvenil', 'B', 'juvenil', 'B') === false);

    ['cadete', 'infantil', 'alevin', 'benjamin', 'prebenjamin'].forEach(c => {
        ok('12e·' + c + ' · Juvenil B sí puede tirar de ' + c,
           puede('juvenil', 'B', c, 'A') === true);
    });

    ok('12f · 🔑🔑 y NUNCA de Regional, que está por encima',
       puede('juvenil', 'B', 'regional', 'A') === false);
    ok('12g · un cadete tampoco puede tirar del juvenil',
       puede('cadete', 'A', 'juvenil', 'C') === false);

    // Las dos FEM, con el rango derivado de su modalidad y duración.
    ok('12h · Regional FEM está al nivel de Regional, no por debajo',
       puede('juvenil', 'A', 'regional_fem', 'A') === false &&
       puede('regional_fem', 'A', 'juvenil', 'A') === true);
    ok('12i · FUTureFEM está a la altura de Alevín (F7, 2T x 35\')',
       puede('infantil', 'A', 'futurefem', 'A') === true &&
       puede('futurefem', 'A', 'infantil', 'A') === false);
    ok('12j · y con las acentuadas/prefijadas también funciona',
       puede('f11_Juvenil', 'B', 'Cadete', 'A') === true &&
       puede('Cadete', 'A', 'f11_Juvenil', 'B') === false);

    // ⚠️ Categoría fuera del escalafón: se MUESTRA, no se esconde.
    ok('12k · 🔑 una categoría desconocida no se oculta en silencio',
       puede('juvenil', 'B', 'liga-interna-del-club', 'A') === true &&
       puede('liga-interna-del-club', 'A', 'juvenil', 'B') === true);

    // Y el filtro está realmente enchufado a la lectura.
    ok('12l · 🔑 cronosFetchClubRosters aplica la regla',
       /cronosPuedeConvocarDe\(eq\.category,\s*eq\.subcategory/.test(
           sinCom(leer('js/roster/team-rosters.js'))));

    // El escalafón NO puede ser el orden de pintado de CT_CATEGORIES.
    const orden = (sb.CT_CATEGORIES || []).map(c => c.id);
    ok('12m · 🔑🔑 el escalafón NO coincide con el orden de CT_CATEGORIES',
       orden.indexOf('futurefem') > orden.indexOf('regional') &&
       sb.cronosCategoryRank('futurefem') < sb.cronosCategoryRank('regional'),
       { pintado: orden.slice(6), rangos: [sb.cronosCategoryRank('futurefem'), sb.cronosCategoryRank('regional')] });
});

parte('PARTE 13 · 🔑🔑 la modalidad NO filtra: F7 puede subir a F11', () => {
    // 💥 EL CASO REAL que reportó el autor (2026-08-12), medido por REST en su
    // club: Juvenil B tiene players_f11=25 y Alevín C tiene players_f7=18. Con
    // el filtro por modalidad, el juvenil abría el selector y NO veía al
    // alevín — "No hay equipos disponibles". En la práctica los jugadores
    // suben de categoría aunque el formato de base sea distinto.
    const src = leer('js/roster/team-rosters.js');
    const sinC = sinCom(src);

    ok('13a · 🔑🔑 ya NO se elige una sola clave players_<modalidad>',
       !/var clave = 'players_' \+ \(mode === 'f7'/.test(sinC), 'sigue filtrando por modalidad');
    ok('13b · se funden las dos plantillas', /_fundirModalidades\(v,\s*preferida\)/.test(sinC));

    // Comportamiento real de la fusión.
    const sb = build();
    const ini = src.indexOf('function _fundirModalidades');
    const fin = src.indexOf('// ── Leer las fichas', ini);
    const sb2 = { console, Object, String, Array };
    vm.createContext(sb2);
    vm.runInContext(src.slice(ini, fin), sb2);
    const fundir = sb2._fundirModalidades;
    ok('13c · la función es aislable y existe', typeof fundir === 'function');

    const equipo = {
        players_f7:  [{ ficha: 'ALC07', dorsal: '7', alias: 'Nico' },
                      { ficha: 'ALC09', dorsal: '9', alias: 'Bruno' }],
        players_f11: [{ ficha: 'ALC07', dorsal: '17', alias: 'Nico' }],
    };
    const enF11 = fundir(equipo, 'f11');
    ok('13d · 🔑🔑 un equipo con plantilla F7 SÍ aparece para un partido de F11',
       fundir({ players_f7: equipo.players_f7 }, 'f11').length === 2,
       fundir({ players_f7: equipo.players_f7 }, 'f11').length);
    ok('13e · 🔑 el mismo jugador en las dos plantillas sale UNA vez',
       enF11.length === 2, enF11.map(p => p.ficha));
    ok('13f · 🔑 y manda la modalidad del partido (dorsal 17, no 7)',
       enF11[0].ficha === 'ALC07' && enF11[0].dorsal === '17', enF11[0]);
    ok('13g · cada jugador dice de qué plantilla sale',
       enF11.every(p => p.modalidad === 'f7' || p.modalidad === 'f11'), enF11);
    ok('13h · sin ficha se deduplica por dorsal+alias, no por alias solo',
       fundir({ players_f7: [{ dorsal: '7', alias: 'Nico' }],
                players_f11: [{ dorsal: '9', alias: 'Nico' }] }, 'f7').length === 2);

    // El aviso de formato distinto tiene que llegar al selector.
    ok('13i · el selector avisa cuando el formato no coincide',
       /p\.modalidad !== _modoActual/.test(sinCom(leer('js/roster/guest-picker.js'))));

    // Y un error real no puede disfrazarse de "no hay equipos".
    ok('13j · 🔑 el motivo del fallo se publica en vez de tragarse',
       /_cronosRosterFetchError\s*=\s*msg/.test(sinC) &&
       /_cronosRosterFetchError/.test(sinCom(leer('js/roster/guest-picker.js'))));
});

parte('PARTE 14 · 🔑🔑 DOBLE PRESENCIA: el invitado sale en los DOS equipos', () => {
    // El caso real del autor: Sisto (ALC18, Alevín C) juega con el Juvenil B.
    const sb = build();
    const PARTIDOS = [
        // Juvenil B: un partido con Sisto de apoyo.
        { category: 'juvenil', subcategory: 'B', players: [
            { playerNumber: '10', playerAlias: 'Iker', minutesPlayed: '90:00', goals: 1 },
            { playerNumber: '26', playerAlias: 'Sisto', minutesPlayed: '25:00', goals: 1,
              isGuest: true, originPlayerId: 'ALC18',
              originCategory: 'alevin', originSubcategory: 'C' },
        ] },
        // Alevín C: un partido suyo, con Sisto de titular.
        { category: 'alevin', subcategory: 'C', players: [
            { playerNumber: '18', playerAlias: 'Sisto', minutesPlayed: '70:00', goals: 2 },
        ] },
    ];

    // ── En el JUVENIL B (acogida) ──────────────────────────────────────
    const enJuvenil = sb.ctAccumulatePlayerStats([PARTIDOS[0]]);
    const sistoJ = enJuvenil.filter(f => f.alias === 'Sisto')[0];
    ok('14a · 🔑 Sisto SÍ aparece en el acumulado del Juvenil B', !!sistoJ, enJuvenil);
    ok('14b · con SÓLO lo que jugó ahí (25 min, 1 gol)',
       sistoJ && sistoJ.minutes === 25 && sistoJ.goals === 1, sistoJ);
    ok('14c · 🔑🔑 y marcado como invitado, con su equipo de origen',
       sistoJ && sistoJ.isGuest === true && /Alev/.test(sistoJ.originLabel || ''), sistoJ);
    ok('14d · conservando su ficha de origen', sistoJ && sistoJ.ficha === 'ALC18', sistoJ);

    const htmlJ = sb.ctRenderStatsTable(enJuvenil, { matchCount: 1 });
    ok('14e · 🔑 la fila del invitado se pinta DIFERENCIADA (naranja)',
       /ct-stats-in/.test(htmlJ.replace(/<style>[\s\S]*?<\/style>/g, '')));
    ok('14f · y el titular de la casa NO', (htmlJ.match(/class="ct-stats-in"/g) || []).length <= 1);

    // ── En el ALEVÍN C (origen) ────────────────────────────────────────
    const enAlevin = sb.ctAccumulatePlayerStats([PARTIDOS[1]]);
    const inv = sb.ctAccumulateGuestStats(PARTIDOS, 'alevin', 'C');
    ok('14g · 🔑 en el Alevín C figura su rendimiento HABITUAL',
       enAlevin.length === 1 && enAlevin[0].minutes === 70 && enAlevin[0].goals === 2, enAlevin);
    ok('14h · 🔑 y debajo la línea suplementaria de sus colaboraciones',
       inv.length === 1 && inv[0].minutes === 25 && inv[0].goals === 1, inv);

    const htmlA = sb.ctRenderStatsTable(enAlevin, { matchCount: 1, guestRows: inv });
    const marcado = htmlA.replace(/<style>[\s\S]*?<\/style>/g, '');
    ok('14i · las dos líneas conviven y son de colores DISTINTOS',
       /ct-stats-guest/.test(marcado) && !/ct-stats-in/.test(marcado), marcado.slice(0, 120));

    // 🔑🔑 EL TOTAL DEL ALEVÍN NO SE INFLA con lo jugado fuera.
    const tfoot = htmlA.slice(htmlA.indexOf('<tfoot>'));
    ok('14j · 🔑🔑 el total del Alevín C sigue siendo 2 goles, no 3',
       />2</.test(tfoot) && !/>3</.test(tfoot), tfoot);
});

parte('PARTE 15 · 🔑 la plantilla ENTERA, con ceros para quien no ha jugado', () => {
    const sb = build();
    const filas = sb.ctAccumulatePlayerStats([{ category: 'juvenil', subcategory: 'B', players: [
        { playerNumber: '10', playerAlias: 'Iker', minutesPlayed: '90:00', goals: 1 },
    ] }]);
    ok('15a · de partida sólo hay quien tiene informes', filas.length === 1);

    const plantilla = [
        { ficha: 'JVB10', dorsal: '10', alias: 'Iker' },
        { ficha: 'JVB07', dorsal: '7',  alias: 'Bruno' },
        { ficha: 'JVB25', dorsal: '25', alias: 'Nico' },
        { ficha: 'JVB02', dorsal: '2',  alias: '' },        // fila vacía: no cuenta
    ];
    const conPlantilla = sb.ctMergeSquadRows(filas, plantilla);
    ok('15b · 🔑 ahora salen los TRES jugadores reales de la plantilla',
       conPlantilla.length === 3, conPlantilla.map(f => f.alias));
    ok('15c · 🔑 el que ya tenía informes NO se duplica',
       conPlantilla.filter(f => f.alias === 'Iker').length === 1, conPlantilla);
    ok('15d · y conserva sus datos', conPlantilla.filter(f => f.alias === 'Iker')[0].minutes === 90);
    const bruno = conPlantilla.filter(f => f.alias === 'Bruno')[0];
    ok('15e · 🔑 los que no han jugado salen con CEROS, no con guiones',
       bruno && bruno.pj === 0 && bruno.minutes === 0 && bruno.goals === 0, bruno);
    ok('15f · marcados como "sin datos" para poder distinguirlos', bruno && bruno.sinDatos === true);
    ok('15g · 🔑 ordenados por dorsal, no apilados al final',
       conPlantilla.map(f => f.number).join(',') === '7,10,25', conPlantilla.map(f => f.number));

    const html = sb.ctRenderStatsTable(conPlantilla, { matchCount: 1 });
    const m = html.replace(/<style>[\s\S]*?<\/style>/g, '');
    ok('15h · la tabla los pinta apagados y con su etiqueta',
       /ct-stats-idle/.test(m) && /sin jugar/.test(m));
    ok('15i · y el rótulo dice cuántos no han jugado', /2 sin jugar/.test(m), m.slice(m.indexOf('<caption'), m.indexOf('</caption>')));

    // ⚠️ SIN plantilla publicada NO se inventa nada.
    ok('15j · 🔑 sin plantilla, la tabla queda EXACTAMENTE como antes',
       sb.ctMergeSquadRows(filas, []) === filas &&
       sb.ctMergeSquadRows(filas, null) === filas);

    // Cruce por dorsal cuando la ficha falta (plantillas antiguas).
    ok('15k · sin ficha se cruza por dorsal y no duplica',
       sb.ctMergeSquadRows(filas, [{ dorsal: '10', alias: 'Iker' }]).length === 1);

    // Y está enchufado en los dos consumidores.
    ok('15l · el Panel de Dirección lo usa',
       /ctMergeSquadRows\(_filas,\s*_sq\)/.test(sinCom(leer('js/coach/reports/reports-tab.js'))));
    ok('15m · y "Mis Informes" del entrenador también',
       /ctMergeSquadRows\(_miFilas,\s*_sq\)/.test(sinCom(leer('js/coach/comms/individual-reports.js'))));
});

parte('PARTE 16 · 🔑 el dorsal se ajusta, la FICHA nunca', () => {
    const src = sinCom(leer('js/roster/guest-picker.js'));
    ok('16a · 🔑🔑 la ficha de origen se copia tal cual al id de la fila',
       /id:\s*p\.ficha \|\| ''/.test(src));
    ok('16b · y originPlayerId también', /originPlayerId:\s*p\.ficha \|\| ''/.test(src));
    ok('16c · 🔑 el dorsal usa el ajustado, no el de origen a ciegas',
       /number:\s*suDorsal/.test(src));
    ok('16d · se busca un número libre cuando choca',
       /ocupados\[suDorsal\]/.test(src) && /for \(var n = 1; n <= 99/.test(src));
    ok('16e · 🔑 las filas vacías NO cuentan como dorsal ocupado',
       /if \(n && \(r\.alias \|\| r\.name\)\) ocupados\[n\] = true;/.test(src),
       'sin esto ningún número quedaría libre nunca');
    ok('16f · y se avisa al entrenador del cambio', /el ' \+ \(p\.dorsal/.test(src));
});

console.log('\n' + (FALLOS ? '❌ ' + FALLOS + ' FALLOS' : '✅ TODO VERDE'));
process.exit(FALLOS ? 1 : 0);

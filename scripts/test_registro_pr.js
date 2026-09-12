// ═══════════════════════════════════════════════════════════════════════════
// GUARD · Registro táctico de Pérdidas y Recuperaciones — v693 (FASE DE PRUEBA)
// ═══════════════════════════════════════════════════════════════════════════
// Encargo del autor (implementar.txt + ampliación del mismo día):
//   · registro rápido de P/R en directo, SÓLO para el equipo propio;
//   · jugador OPCIONAL (si no se asigna, queda a nivel colectivo);
//   · disponible sólo en Cadete, Juvenil y Regional (incl. femeninas);
//   · gobernado por un EXTRA del SuperAdmin;
//   · los datos salen en el informe colectivo y en el individual.
//
// ⚠️ ESTE GUARD EJECUTA EL MÓDULO, no lo lee. La lección de v679 (y v596, y
// v620) es que medir la FORMA del código no prueba su COMPORTAMIENTO: allí una
// aserción que comprobaba el ORDEN del texto siguió VERDE con la guarda
// neutralizada. Aquí las dos puertas se abren y se cierran de verdad, y se
// pregunta por el resultado.
//
// LO QUE NO PUEDE VER: si el gesto es ÁGIL en el banquillo — que es justo lo
// que el autor quiere validar con la prueba de campo. Eso no lo dice ningún
// test.
// ═══════════════════════════════════════════════════════════════════════════
'use strict';

const fs   = require('fs');
const path = require('path');
const vm   = require('vm');
const { execFileSync } = require('child_process');

const RAIZ = path.join(__dirname, '..');
const leer = f => fs.readFileSync(path.join(RAIZ, f), 'utf8');

let fallos = 0, total = 0;
function ok(nombre, cond) {
    total++;
    if (cond) console.log(`  ✓ ${nombre}`);
    else { console.log(`  ✗ ${nombre}`); fallos++; }
}

// Extrae `window.NOMBRE = function ... }` emparejando llaves.
function extraeAsignacion(src, nombre) {
    const start = src.indexOf('window.' + nombre + ' = function');
    if (start < 0) return null;
    let i = src.indexOf('{', start), depth = 0;
    for (; i < src.length; i++) {
        if (src[i] === '{') depth++;
        else if (src[i] === '}') { depth--; if (depth === 0) { i++; break; } }
    }
    return src.slice(start, i) + ';';
}

// ═══ 0. SINTAXIS ════════════════════════════════════════════════════════════
const FICHEROS = [
    'js/match/events/possession-tracker.js',
    'js/ui/render.js',
    'js/core/utils.js',
    'js/admin/superadmin/extras-toggle.js',
    'js/coach/reports/report-engine.js',
    'js/coach/comms/individual-reports.js',
];
let compilanTodos = true;
FICHEROS.forEach(f => {
    try { execFileSync(process.execPath, ['--check', path.join(RAIZ, f)], { stdio: 'pipe' }); }
    catch (e) { compilanTodos = false; }
});
ok('todos los ficheros tocados compilan (node --check)', compilanTodos);

const tracker = leer('js/match/events/possession-tracker.js');
const utils   = leer('js/core/utils.js');

// ═══════════════════════════════════════════════════════════════════════════
//  1. LA PUERTA DE LA CATEGORÍA — ejecutando el helper REAL de utils.js
// ═══════════════════════════════════════════════════════════════════════════
const ctxCat = { window: {}, console };
vm.createContext(ctxCat);
vm.runInContext(
    'function _cronosNoEsAcento(c){var cp=c.codePointAt(0);return !(cp>=0x300&&cp<=0x36f);}\n' +
    (extraeAsignacion(utils, 'cronosCategoriaConRegistroPR') || 'window.cronosCategoriaConRegistroPR=null;'),
    ctxCat
);
const catOK = ctxCat.window.cronosCategoriaConRegistroPR;
ok('utils.js expone cronosCategoriaConRegistroPR', typeof catOK === 'function');

if (typeof catOK === 'function') {
    // DENTRO: las tres que pidió, en las formas en que llega la categoría.
    ok('DENTRO · Cadete (clave, etiqueta y con subcategoría)',
       catOK('f11_cadete') && catOK('Cadete') && catOK('cadete_b'));
    ok('DENTRO · Juvenil', catOK('f11_juvenil') && catOK('Juvenil (2T x 45\')'));
    ok('DENTRO · Regional', catOK('f11_regional') && catOK('Regional'));
    // ⚠️ La trampa de v511: 'regional_fem' CONTIENE 'regional'. Aquí eso es lo
    // deseado (el autor quiere las femeninas dentro), y se fija para que nadie
    // "arregle" el orden al copiar el patrón del helper de al lado.
    ok('DENTRO · Regional FEM (el encargo incluye las femeninas)',
       catOK('f11_regional_fem') && catOK('Regional FEM'));

    // FUERA: las inferiores.
    ok('FUERA · Prebenjamín, Benjamín, Alevín e Infantil',
       !catOK('f7_prebenjamin') && !catOK('f11_benjamin') &&
       !catOK('f7_alevin') && !catOK('f11_infantil'));
    ok('FUERA · FUTureFEM (formación femenina, F7 — decisión documentada)',
       !catOK('f11_futurefem') && !catOK('FUTureFEM'));
    ok('FUERA · categoría vacía o ausente no abre la puerta',
       !catOK('') && !catOK(null) && !catOK(undefined));
}

// ═══════════════════════════════════════════════════════════════════════════
//  2. EL MÓDULO, EJECUTADO CON UN DOM DE MENTIRA
// ═══════════════════════════════════════════════════════════════════════════
// ⚠️ `add`/`remove` aceptan VARIOS nombres, como el DOM real. Con un solo
// argumento, `classList.remove('desde-izq','desde-der')` sólo quitaba el
// primero y el elemento acababa con las dos clases de anclaje a la vez: el
// guard daba rojo por pobreza del simulacro, no por un defecto del módulo.
function claseStub() {
    const s = new Set();
    return {
        _set: s,
        add:    (...cs) => cs.forEach(c => s.add(c)),
        remove: (...cs) => cs.forEach(c => s.delete(c)),
        contains: c => s.has(c),
        toggle: (c, on) => { if (on === undefined) { s.has(c) ? s.delete(c) : s.add(c); } else if (on) s.add(c); else s.delete(c); }
    };
}

function montaEntorno(opciones) {
    const o = opciones || {};
    const porId = {};
    function nuevo(id) {
        const el = {
            id: id || '', _html: '', classList: claseStub(), style: {}, textContent: '',
            attrs: {},
            addEventListener: () => {},
            setAttribute: (k, v) => { el.attrs[k] = v; },
            getAttribute: k => (k in el.attrs ? el.attrs[k] : null),
            removeAttribute: k => { delete el.attrs[k]; },
            appendChild: hijo => { if (hijo && hijo.id) porId[hijo.id] = hijo; return hijo; },
            querySelectorAll: () => [],
            querySelector: () => null,
        };
        Object.defineProperty(el, 'innerHTML', {
            get: () => el._html,
            set: v => {
                el._html = String(v);
                // El módulo pinta sus botones con innerHTML y luego los busca
                // por id: se registran los ids que aparezcan en el marcado.
                (el._html.match(/id="([^"]+)"/g) || []).forEach(m => {
                    const id2 = m.slice(4, -1);
                    if (!porId[id2]) porId[id2] = nuevo(id2);
                });
            }
        });
        if (id) porId[id] = el;
        return el;
    }

    const almacen = {};
    const doc = {
        readyState: 'complete',
        head: nuevo('head'),
        body: Object.assign(nuevo('body'), { classList: claseStub() }),
        addEventListener: () => {},
        createElement: () => nuevo(''),
        getElementById: id => porId[id] || null,
        querySelectorAll: () => [],
    };

    const ctxRef = {};        // puente para quedarse con el callback del vigía
    const ctx = {
        document: doc,
        console: { log: () => {}, warn: () => {}, error: () => {} },
        setTimeout: () => 0, clearTimeout: () => {},
        // El vigía del estado del reloj se guarda en vez de correr: así el
        // guard puede dispararlo a mano y comprobar que repinta de verdad,
        // sin esperar un segundo real ni dejar temporizadores colgando.
        setInterval: (fn) => { ctxRef.tickVigia = fn; return 1; },
        clearInterval: () => {},
        Date, Math, JSON, String, Number, Array, Object, parseInt, localStorage: {
            getItem: k => (k in almacen ? almacen[k] : null),
            setItem: (k, v) => { almacen[k] = String(v); },
            removeItem: k => { delete almacen[k]; }
        },
        // Globales del partido
        liveMatchId: o.matchId || 'm_test',
        players: o.players || [],
        masterTimeH1: 754, masterTimeH2: 0,
        // v695 · Estado del partido. Por defecto EN JUEGO (reloj corriendo y
        // primera parte), que es el escenario normal de registro.
        matchPhase: (o.fase === undefined) ? '1st_half' : o.fase,
        isRunning:  (o.corriendo === undefined) ? true : o.corriendo,
        escapeHtml: s => String(s),
        showToast: () => {},
        window: {
            _userTeamRole: o.rol || 'home',
            _currentMatchCategory: (o.categoria === undefined) ? 'f11_juvenil' : o.categoria,
            cronosCategoriaConRegistroPR: catOK,
            _cronosExtraEnabled: key => {
                if (!o.extras) return true;                 // sin mapa: todo activo
                return o.extras[key] !== false;             // la regla real: `!== false`
            }
        },
        _almacen: almacen
    };
    ctx.window.window = ctx.window;
    ctx._ref = ctxRef;
    vm.createContext(ctx);
    vm.runInContext(tracker, ctx, { filename: 'possession-tracker.js' });
    return ctx;
}

const PLANTILLA = [
    { id: 1, number: 7,  name: 'Nano',  team: 'home', status: 'field' },
    { id: 2, number: 10, name: 'Bruno', team: 'home', status: 'field' },
    { id: 3, number: 15, name: 'Romu',  team: 'home', status: 'bench' },
    { id: 9, number: 4,  name: 'Rival', team: 'away', status: 'field' },
];

// ── Carga y puertas ─────────────────────────────────────────────────────────
let base;
try { base = montaEntorno({ players: PLANTILLA }); ok('el módulo se carga sin reventar con el DOM mínimo', true); }
catch (e) { ok('el módulo se carga sin reventar con el DOM mínimo', false); console.log('    ' + e.message); }

if (base) {
    ok('CONTROL · con extra activo y categoría Juvenil, la función está disponible',
       base.window.cronosPRDisponible() === true);

    const apagado = montaEntorno({ players: PLANTILLA, extras: { registro_pr: false } });
    ok('el EXTRA apagado cierra la función (aunque la categoría valga)',
       apagado.window.cronosPRDisponible() === false);

    // ⚠️ La cara POSITIVA de la regla `!== false`, que es la que se olvida: un
    // club que nunca pasó por el panel del SuperAdmin NO tiene el campo, y
    // comparar con `=== true` lo habría dejado sin la función sin querer.
    const ausente = montaEntorno({ players: PLANTILLA, extras: { otra_cosa: true } });
    ok('el extra AUSENTE deja la función disponible (regla `!== false`)',
       ausente.window.cronosPRDisponible() === true);

    const alevin = montaEntorno({ players: PLANTILLA, categoria: 'f7_alevin' });
    ok('la CATEGORÍA inferior cierra la función (aunque el extra esté activo)',
       alevin.window.cronosPRDisponible() === false);

    // ── Registro ────────────────────────────────────────────────────────────
    const it1 = base.window.cronosPRRegistra('loss');
    const it2 = base.window.cronosPRRegistra('recovery');
    const it3 = base.window.cronosPRRegistra('loss');

    ok('un toque registra al instante, sin jugador (colectivo)',
       !!it1 && it1.playerId === null && it1.kind === 'loss');

    ok('el registro lleva el minuto de partido (12:34 de la 1ª parte)',
       !!it1 && it1.matchTime === '1T 12:34');

    let r = base.window.cronosPRDelPartido();
    ok('el agregado cuenta 2 pérdidas y 1 recuperación, todas sin asignar',
       r.perdidas.total === 2 && r.recuperaciones.total === 1 &&
       r.perdidas.sinAsignar === 2 && r.recuperaciones.sinAsignar === 1);

    // ── Asignación opcional ─────────────────────────────────────────────────
    base.window.cronosPRAsigna(it1.id, 1);          // → dorsal 7
    base.window.cronosPRAsigna(it2.id, 2);          // → dorsal 10
    r = base.window.cronosPRDelPartido();
    ok('asignar mueve el registro de "colectivo" al DORSAL del jugador',
       r.perdidas.porDorsal['7'] === 1 && r.perdidas.sinAsignar === 1 &&
       r.recuperaciones.porDorsal['10'] === 1 && r.recuperaciones.sinAsignar === 0);

    ok('el total NO cambia al asignar (se completa el registro, no se crea otro)',
       r.perdidas.total === 2 && r.recuperaciones.total === 1);

    ok('cronosPRDeJugador devuelve lo de ese dorsal y sólo lo suyo',
       base.window.cronosPRDeJugador(r, 7).perdidas === 1 &&
       base.window.cronosPRDeJugador(r, 7).recuperaciones === 0 &&
       base.window.cronosPRDeJugador(r, 10).recuperaciones === 1 &&
       base.window.cronosPRDeJugador(r, 99).perdidas === 0);

    // ── Deshacer ────────────────────────────────────────────────────────────
    base.window.cronosPRDeshace(it3.id);
    r = base.window.cronosPRDelPartido();
    ok('deshacer retira el registro del agregado',
       r.perdidas.total === 1 && r.perdidas.sinAsignar === 0);

    // ── Sólo MI equipo ──────────────────────────────────────────────────────
    // El rival no puede recibir P/R: el encargo es explícito ("exclusiva para
    // nuestro propio equipo").
    const antes = base.window.cronosPRDelPartido().perdidas.total;
    const itR = base.window.cronosPRRegistra('loss');
    const asignadoAlRival = base.window.cronosPRAsigna(itR.id, 9);
    const rr = base.window.cronosPRDelPartido();
    ok('no se puede asignar a un jugador del RIVAL',
       asignadoAlRival === false && !rr.perdidas.porDorsal['4'] &&
       rr.perdidas.total === antes + 1);
    base.window.cronosPRDeshace(itR.id);

    // La barra de asignación sólo ofrece a los MÍOS que están en el campo.
    const itB = base.window.cronosPRRegistra('loss');
    const barra = base.document.getElementById('cronos-pr-assign');
    const htmlBarra = barra ? barra.innerHTML : '';
    ok('la barra ofrece los dorsales de mi equipo EN EL CAMPO',
       /data-pid="1"/.test(htmlBarra) && /data-pid="2"/.test(htmlBarra));
    ok('…y NO ofrece al rival ni a los del banquillo',
       !/data-pid="9"/.test(htmlBarra) && !/data-pid="3"/.test(htmlBarra));
    base.window.cronosPRDeshace(itB.id);

    // Jugando de VISITANTE, "mi equipo" es el away (v-role): darlo por hecho
    // 'home' habría dejado la función inservible en los partidos fuera.
    const fuera = montaEntorno({ players: PLANTILLA, rol: 'away', matchId: 'm_fuera' });
    const itF = fuera.window.cronosPRRegistra('loss');
    const barraF = fuera.document.getElementById('cronos-pr-assign');
    ok('de VISITANTE, la barra ofrece a los del equipo away',
       !!itF && /data-pid="9"/.test(barraF ? barraF.innerHTML : '') &&
       !/data-pid="1"/.test(barraF ? barraF.innerHTML : ''));

    // ── Persistencia ────────────────────────────────────────────────────────
    // 🔑 Sin esto, una recarga a media parte se llevaría por delante todo lo
    // registrado, y el dato no se puede reconstruir a mano.
    const guardado = base._almacen['cronos_pr::m_test'];
    ok('lo registrado se guarda en localStorage con la clave del partido',
       !!guardado && /"kind"/.test(guardado));

    ok('no se registra nada si la función NO está disponible (categoría inferior)',
       alevin.window.cronosPRRegistra('loss') === null &&
       alevin.window.cronosPRDelPartido().perdidas.total === 0);
}

// ═══════════════════════════════════════════════════════════════════════════
//  2 bis. v694 · RECTIFICAR, LIMPIAR, ESQUINAS Y PANEL DE RESUMEN
// ═══════════════════════════════════════════════════════════════════════════
{
    const e = montaEntorno({ players: PLANTILLA, matchId: 'm_v694' });
    // Se registran cinco apuntes, dos de ellos asignados.
    const a = e.window.cronosPRRegistra('loss');
    const b = e.window.cronosPRRegistra('loss');
    const c = e.window.cronosPRRegistra('recovery');
    const d = e.window.cronosPRRegistra('loss');
    const f = e.window.cronosPRRegistra('recovery');
    e.window.cronosPRAsigna(a.id, 1);
    e.window.cronosPRAsigna(c.id, 2);
    ok('CONTROL · cinco apuntes registrados (3 pérdidas, 2 recuperaciones)',
       e.window.cronosPRDelPartido().perdidas.total === 3 &&
       e.window.cronosPRDelPartido().recuperaciones.total === 2);

    // ↩ RECTIFICAR — acumulativo, del final hacia el comienzo.
    // 🔑 Pulsar tres veces tiene que quitar los TRES últimos, uno a uno: es
    // literalmente lo que pidió el autor.
    const q1 = e.window.cronosPRRectifica();
    ok('rectificar quita el ÚLTIMO registro', q1 && q1.id === f.id);
    const q2 = e.window.cronosPRRectifica();
    const q3 = e.window.cronosPRRectifica();
    ok('…y es ACUMULATIVO: tres pulsaciones quitan los tres últimos, en orden',
       q2 && q2.id === d.id && q3 && q3.id === c.id);
    const tras3 = e.window.cronosPRDelPartido();
    ok('quedan los dos primeros, con su asignación intacta',
       tras3.perdidas.total === 2 && tras3.recuperaciones.total === 0 &&
       tras3.perdidas.porDorsal['7'] === 1);

    // ⚠️ Rectificar con la lista vacía NO puede reventar ni dejar basura.
    e.window.cronosPRRectifica();
    e.window.cronosPRRectifica();
    const vacio = e.window.cronosPRRectifica();
    ok('rectificar de más no rompe nada (devuelve null con la lista vacía)',
       vacio === null && e.window.cronosPRDelPartido().perdidas.total === 0);

    // 🗑 LIMPIAR — todo el partido de golpe.
    const e2 = montaEntorno({ players: PLANTILLA, matchId: 'm_clr' });
    e2.window.cronosPRRegistra('loss');
    e2.window.cronosPRRegistra('recovery');
    e2.window.cronosPRRegistra('loss');
    // Sin confirmar (el entorno de prueba no tiene `confirm`): se pasa el
    // parámetro explícito, que es el camino que usa el botón tras aceptar.
    const borrados = e2.window.cronosPRLimpiaTodo(true);
    const trasClr = e2.window.cronosPRDelPartido();
    ok('limpiar borra TODO el partido de golpe y deja los contadores a cero',
       borrados === 3 && trasClr.perdidas.total === 0 && trasClr.recuperaciones.total === 0);

    ok('…y también lo borra de localStorage (una recarga no lo resucita)',
       !/"kind"/.test(e2._almacen['cronos_pr::m_clr'] || ''));

    // 🚨 LIMPIAR PIDE CONFIRMACIÓN. Es irreversible y el botón está en una
    // pantalla que se usa con el dedo y con prisa: un roce no puede llevarse
    // el partido entero. Aquí `confirm` devuelve NO y no debe borrar nada.
    const e3 = montaEntorno({ players: PLANTILLA, matchId: 'm_cancel' });
    e3.window.cronosPRRegistra('loss');
    e3.confirm = () => false;
    const cancelado = e3.window.cronosPRLimpiaTodo();
    ok('limpiar CANCELADO no borra nada',
       cancelado === 0 && e3.window.cronosPRDelPartido().perdidas.total === 1);

    // 📊 PANEL DE RESUMEN, consultable en cualquier momento.
    const e4 = montaEntorno({ players: PLANTILLA, matchId: 'm_panel' });
    const x1 = e4.window.cronosPRRegistra('loss');
    e4.window.cronosPRAsigna(x1.id, 1);          // dorsal 7
    e4.window.cronosPRRegistra('recovery');      // colectiva
    e4.window.cronosPRAbrePanel();
    const panel = e4.document.getElementById('cronos-pr-panel');
    const html  = panel ? panel.innerHTML : '';
    ok('el panel se abre y muestra el desglose del jugador con registros',
       /🔻 1/.test(html) && /Nano/.test(html));
    // 🔑 También los que están a CERO y los del banquillo: en la banda hace
    // falta ver la plantilla entera, no sólo a los "manchados".
    ok('…lista también a los jugadores a cero y a los del banquillo',
       /Bruno/.test(html) && /Romu/.test(html) && /banq\./.test(html));
    ok('…y NO cuela a nadie del equipo rival', !/Rival/.test(html));
    ok('el panel ofrece rectificar y limpiar',
       /data-acc="rect"/.test(html) && /data-acc="clr"/.test(html));
    ok('el panel informa de los registros colectivos sin asignar',
       /Sin asignar/.test(html));

    e4.window.cronosPRCierraPanel();
    ok('el panel se cierra', !panel.classList.contains('on'));

    // ── Anclaje del desplegable: HACIA DENTRO del campo ──
    const e5 = montaEntorno({ players: PLANTILLA, matchId: 'm_lado' });
    e5.window.cronosPRRegistra('loss');
    const asignador = e5.document.getElementById('cronos-pr-assign');
    ok('la ventana de PÉRDIDA (botón derecho) se ancla a la derecha',
       asignador.classList.contains('desde-der') && !asignador.classList.contains('desde-izq'));
    e5.window.cronosPRRegistra('recovery');
    ok('la ventana de RECUPERACIÓN (botón izquierdo) se ancla a la izquierda',
       asignador.classList.contains('desde-izq') && !asignador.classList.contains('desde-der'));
}

// ── Colocación: las esquinas se declaran en el CSS del propio módulo ────────
ok('en móvil/iPad la barra se reparte a las esquinas (≤1366px)',
   /@media \(max-width: 1366px\)/.test(tracker) &&
   /justify-content:space-between/.test(tracker));

// El ORDEN del DOM es el que decide qué botón cae en cada esquina: R primero
// (izquierda) y P al final (derecha), como las anotaciones de las capturas.
ok('el orden del marcado deja R a la izquierda y P a la derecha',
   tracker.indexOf("id=\"cronos-pr-rec\"") < tracker.indexOf("id=\"cronos-pr-sum\"") &&
   tracker.indexOf("id=\"cronos-pr-sum\"") < tracker.indexOf("id=\"cronos-pr-loss\""));

ok('el desplegable tiene anclaje a los dos lados en el CSS',
   /#cronos-pr-assign\.desde-izq\{left:10px/.test(tracker) &&
   /#cronos-pr-assign\.desde-der\{right:10px/.test(tracker));

// ═══════════════════════════════════════════════════════════════════════════
//  2 ter. v695 · SÓLO CON EL PARTIDO EN JUEGO
// ═══════════════════════════════════════════════════════════════════════════
//  Reporte del autor (captura 10282): partido sin empezar —botón EMPEZAR,
//  cronómetros en 45:00— y la barra marcando «R 2 · P 1».
{
    // CONTROL: en juego de verdad, se registra (si esto fallara, los cuatro
    // "no se registra" de abajo darían verde sin probar nada).
    const jugando = montaEntorno({ players: PLANTILLA, matchId: 'm_play' });
    ok('CONTROL · con el reloj en marcha y 1ª parte, SÍ se registra',
       jugando.window.cronosPREnJuego() === true &&
       jugando.window.cronosPRRegistra('loss') !== null);

    const casos = [
        ['ANTES de empezar (reloj parado, 1ª parte)', { corriendo: false, fase: '1st_half' }],
        ['en PAUSA en la 2ª parte',                   { corriendo: false, fase: '2nd_half' }],
        ['en el DESCANSO',                            { corriendo: false, fase: 'break' }],
        ['con el partido ya FINALIZADO',              { corriendo: false, fase: 'finished' }],
    ];
    casos.forEach(([nombre, estado], i) => {
        const e = montaEntorno(Object.assign({ players: PLANTILLA, matchId: 'm_blq' + i }, estado));
        const r = e.window.cronosPRRegistra('loss');
        ok('no se registra ' + nombre,
           e.window.cronosPREnJuego() === false && r === null &&
           e.window.cronosPRDelPartido().perdidas.total === 0);
    });

    // ⚠️ El reloj corriendo NO basta: en 'break' o 'finished' con `isRunning`
    // en true (un estado adoptado del servidor, por ejemplo) tampoco se
    // registra. Por eso la puerta mira LAS DOS cosas.
    const raro = montaEntorno({ players: PLANTILLA, matchId: 'm_raro', corriendo: true, fase: 'break' });
    ok('el reloj en marcha durante el DESCANSO tampoco abre la puerta',
       raro.window.cronosPREnJuego() === false && raro.window.cronosPRRegistra('recovery') === null);

    // 🔑 SÓLO SE BLOQUEA EL REGISTRO: corregir y consultar con el reloj parado
    // es justo lo que se hace en el descanso.
    const desc = montaEntorno({ players: PLANTILLA, matchId: 'm_desc' });
    const d1 = desc.window.cronosPRRegistra('loss');
    desc.window.cronosPRRegistra('recovery');
    desc.isRunning = false; desc.matchPhase = 'break';        // suena el descanso
    ok('en el descanso SÍ se puede asignar un registro anterior',
       desc.window.cronosPRAsigna(d1.id, 1) === true);
    ok('…y rectificar', desc.window.cronosPRRectifica() !== null);
    ok('…y abrir el panel de resumen', desc.window.cronosPRAbrePanel() === true);
    ok('…y limpiarlo todo', desc.window.cronosPRLimpiaTodo(true) >= 0);

    // El aspecto del botón acompaña al bloqueo (el candado real está en la
    // función, esto es sólo que se vea).
    const apagado = montaEntorno({ players: PLANTILLA, matchId: 'm_off', corriendo: false });
    apagado.window.cronosPRActualiza();
    const bl = apagado.document.getElementById('cronos-pr-loss');
    const br = apagado.document.getElementById('cronos-pr-rec');
    const bs = apagado.document.getElementById('cronos-pr-sum');
    ok('los botones P y R se pintan apagados cuando no hay juego',
       bl.classList.contains('off') && br.classList.contains('off'));
    ok('…pero el 📊 del resumen NO se apaga nunca',
       !bs.classList.contains('off'));

    const encendido = montaEntorno({ players: PLANTILLA, matchId: 'm_on' });
    encendido.window.cronosPRActualiza();
    ok('CONTROL · con el partido en juego los botones están encendidos',
       !encendido.document.getElementById('cronos-pr-loss').classList.contains('off'));

    // 🚨 EL RELOJ CAMBIA SIN REPINTAR LAS FICHAS: pausar, el descanso y el
    // final por tiempo no pasan por `renderPlayers()`. Aquí se pausa el
    // partido y se dispara el vigía para comprobar que los botones se apagan
    // solos; sin él se quedarían encendidos con el partido parado.
    encendido.isRunning = false;
    if (typeof encendido._ref.tickVigia === 'function') encendido._ref.tickVigia();
    ok('al PAUSAR, los botones se apagan solos (sin repintar las fichas)',
       encendido.document.getElementById('cronos-pr-loss').classList.contains('off'));

    encendido.isRunning = true;
    if (typeof encendido._ref.tickVigia === 'function') encendido._ref.tickVigia();
    ok('…y al REANUDAR vuelven a encenderse',
       !encendido.document.getElementById('cronos-pr-loss').classList.contains('off'));
}

// ═══════════════════════════════════════════════════════════════════════════
//  3. EL CAMINO HASTA LOS INFORMES
// ═══════════════════════════════════════════════════════════════════════════
const escritores = [
    'js/coach/comms/collective-report.js',
    'js/coach/comms/match-reports-auto.js',
    'js/coach/comms/match-reports-send.js',
];
let copias = 0, conComments = 0;
escritores.forEach(f => {
    const src = leer(f);
    copias      += (src.match(/matchPR:/g) || []).length;
    conComments += (src.match(/matchComments:/g) || []).length;
});
// 🔑 Uno por cada copia de comentarios: son las mismas copias (cuerpo técnico
// y entrenador). Si alguien añade un despacho nuevo con matchComments y se
// olvida de matchPR, este recuento lo caza.
ok('cada copia que lleva matchComments lleva también matchPR',
   copias > 0 && copias === conComments);

const engine = leer('js/coach/reports/report-engine.js');
ok('el informe colectivo pinta el panel de P/R',
   /buildPRPanel\(_prDelInforme\(m\), players\)/.test(engine));

// ── El motor del informe, EJECUTADO de verdad ───────────────────────────────
// 🔑 El encargo pide "asegurar que estos datos se listen correctamente". Que
// la llamada esté escrita no prueba que salga nada: aquí se construye el
// informe real y se mira el HTML.
{
    const sb = {};
    vm.createContext(sb);
    vm.runInContext(engine + '\n;this.__RP = _RP;', sb);
    const RP = sb.__RP;

    const PR = {
        perdidas:       { total: 4, sinAsignar: 1, porDorsal: { '7': 2, '10': 1 } },
        recuperaciones: { total: 3, sinAsignar: 0, porDorsal: { '7': 1, '10': 2 } },
        items: []
    };
    const jug = (n, alias, extra) => Object.assign({
        playerNumber: String(n), playerAlias: alias, minutesPlayed: '70:00',
        goals: 0, cards: null, history: []
    }, extra || {});
    const m = {
        matchDate: '2026-09-12', rival: 'RIVAL', scoreHome: 1, scoreAway: 0, category: 'juvenil',
        players: [jug(7, 'NANO', { matchPR: PR }), jug(10, 'BRUNO', { matchPR: PR })]
    };
    let h = '';
    try { h = RP.build(m, { clubName: 'CD' }); } catch (e) { h = 'ERROR ' + e.message; }

    ok('el informe construido LISTA la sección de pérdidas y recuperaciones',
       /Pérdidas y recuperaciones/.test(h));
    ok('…con los totales del equipo y el balance',
       /">4<\/div>/.test(h) && /">3<\/div>/.test(h) && /-1</.test(h));
    ok('…y el desglose por jugador, con su nombre',
       /🔻 2/.test(h) && /NANO/.test(h) && /🔺 2/.test(h) && /BRUNO/.test(h));
    ok('…contando el dato UNA vez, aunque venga repetido en cada documento',
       (h.match(/Pérdidas y recuperaciones/g) || []).length === 1);
    ok('…y avisando de los registros colectivos sin asignar',
       /sin jugador asignado/.test(h));

    // ⚠️ Un partido donde NO se usó la función no puede cargar con una sección
    // vacía: los informes viejos tienen que salir exactamente igual que antes.
    const viejo = RP.build({
        matchDate: '2026-09-12', rival: 'R', scoreHome: 0, scoreAway: 0, category: 'juvenil',
        players: [jug(7, 'NANO')]
    }, { clubName: 'CD' });
    ok('un informe SIN P/R sale como siempre (sin sección vacía)',
       !/Pérdidas y recuperaciones/.test(viejo));
}

const indiv = leer('js/coach/comms/individual-reports.js');
ok('el informe individual usa el desglose por dorsal, no un campo nuevo del jugador',
   /cronosPRDeJugador\(window\.cronosPRDelPartido\(\), p\.number\)/.test(indiv));

ok('el extra está declarado en el panel del SuperAdmin',
   /key:\s*'registro_pr'/.test(leer('js/admin/superadmin/extras-toggle.js')));

// El enganche va en renderPlayers, el único punto por el que pasan TODOS los
// caminos de arranque (lección de v692).
ok('los botones se sincronizan desde renderPlayers()',
   /cronosPRActualiza/.test(leer('js/ui/render.js')));

ok('index.html carga el módulo',
   /possession-tracker\.js/.test(leer('index.html')));

// ═══════════════════════════════════════════════════════════════════════════
console.log(`\n  ${total - fallos}/${total} aserciones`);
process.exit(fallos ? 1 : 0);

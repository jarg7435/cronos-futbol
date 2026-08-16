// ─────────────────────────────────────────────────────────────────────────
// test_partido_por_equipo.js · cada EQUIPO gestiona su partido de forma
// completamente aislada, aunque los lleve el mismo entrenador en la misma
// pestaña (v557)
//
// Reporte del autor (captura 9042): con un partido en curso del Alevín C, al
// cambiar al Regional A desde el selector del panel (v540) y preparar el
// partido de ese segundo equipo saltaba
//     "⚠️ Hay un PARTIDO EN CURSO sin finalizar (2ª PARTE, 1-0)"
// con el marcador y la fase DEL ALEVÍN, obligando a reanudar aquél o a perder
// su progreso.
//
// 🔑🔑🔑 LA CAUSA: v465 AISLÓ POR PESTAÑA, Y ESE NO ES EL EJE. El puntero
// `cronos_tab_match` vive en sessionStorage (por pestaña), así que dos
// partidos en dos pestañas sí quedaban separados — pero DOS EQUIPOS EN LA
// MISMA PESTAÑA comparten sessionStorage. Al cambiar de equipo, la pestaña
// seguía reclamando el partido del equipo anterior y todo lo que cuelga de ese
// puntero hablaba del equipo equivocado.
//
// LA REGLA QUE FIJA ESTE GUARD: la unidad es el EQUIPO —`clubId` + categoría +
// subcategoría, o sea el `teamId` canónico de utils.js—, no la pestaña y no la
// persona. El puntero pasa a ser `cronos_tab_match::<teamId>` y cada estado
// guardado lleva dentro su `teamId`.
//
// ⚠️ SE EJECUTA EL CÓDIGO REAL. match-slots.js se carga entero en un sandbox;
// de app-init.js se extraen y ejecutan los tres bloques implicados
// (`_guardAgainstMatchReset`, el autoguardado y `_cronosNuevoPartidoDeEquipo`).
// Sólo la PARTE 6 mira el fuente, y sólo para el cableado que no se puede
// ejecutar sin navegador.
// ─────────────────────────────────────────────────────────────────────────
'use strict';

const fs   = require('fs');
const path = require('path');
const vm   = require('vm');

const ROOT = path.join(__dirname, '..');
let fail = 0, pass = 0;
const ok = (name, cond, extra) => {
    if (cond) { pass++; console.log('PASS ' + name); }
    else { fail++; console.log('FAIL ' + name); if (extra !== undefined) console.log('       ' + extra); }
};

const SLOTS_SRC = fs.readFileSync(path.join(ROOT, 'js', 'core', 'match-slots.js'), 'utf8');
const APPINIT   = fs.readFileSync(path.join(ROOT, 'js', 'core', 'app-init.js'), 'utf8');
const IMPORTJS  = fs.readFileSync(path.join(ROOT, 'js', 'ai', 'import.js'), 'utf8');
const SETUP     = fs.readFileSync(path.join(ROOT, 'js', 'core', 'setup-modal.js'), 'utf8');

// Los dos equipos del reporte, con la clave que produce cronosTeamId().
const ALEVIN   = 'cd-dia__alevin__c';
const REGIONAL = 'cd-dia__regional__a';

console.log('── un partido por EQUIPO, aislados de verdad (v557) ──\n');

// ══════════ Almacenes simulados ══════════
function crearAlmacen() {
    const m = new Map();
    return {
        getItem: (k) => (m.has(k) ? m.get(k) : null),
        setItem: (k, v) => { m.set(k, String(v)); },
        removeItem: (k) => { m.delete(k); },
        get length() { return m.size; },
        key: (i) => Array.from(m.keys())[i],
        _mapa: m,
    };
}
function comoStorage(almacen) {
    return new Proxy(almacen, {
        ownKeys: () => Array.from(almacen._mapa.keys()),
        getOwnPropertyDescriptor: () => ({ enumerable: true, configurable: true }),
        get: (t, p) => (typeof t[p] === 'function' ? t[p].bind(t) : t[p]),
    });
}

// Una pestaña del entrenador. `equipo` es MUTABLE: cambiarlo es exactamente lo
// que hace pulsar el otro botón en "MIS EQUIPOS".
function abrirPestana(lsCompartido, equipoInicial) {
    const ctl = { equipo: equipoInicial || '' };
    const sandbox = {
        localStorage:   comoStorage(lsCompartido || crearAlmacen()),
        sessionStorage: comoStorage(crearAlmacen()),
        console: { warn() {}, log() {}, error() {} },
        Object, JSON, Date, Math, String, Number, Array, parseInt, isNaN,
        setInterval, clearInterval,
    };
    sandbox.window = sandbox;
    // Así es como el panel publica el equipo abierto (utils.js, v540).
    sandbox.cronosEquipoElegido = () => ctl.equipo;
    vm.createContext(sandbox);
    vm.runInContext(SLOTS_SRC, sandbox);
    return { win: sandbox, S: sandbox.window._cronosMatchSlots, ctl };
}

const estado = (o) => Object.assign({
    savedAt: new Date().toISOString(),
    createdAt: new Date().toISOString(),
    matchPhase: '1st_half', isRunning: true,
    masterTimeH1: 600, masterTimeH2: 0,
    scoreHome: '0', scoreAway: '0',
    teamNames: { home: 'CRONOS', away: 'RIVAL' },
    players: [{ id: 1 }],
}, o);

// ═══════════ PARTE 1 · dos equipos, una pestaña, dos ranuras ═══════════
console.log('── PARTE 1 · el Alevín y el Regional no se tocan ──');
{
    const LS = crearAlmacen();
    const { win, S, ctl } = abrirPestana(LS, ALEVIN);

    // El entrenador juega con el Alevín.
    S.setTabMatchId('m-alevin');
    S.guardar('m-alevin', estado({ liveMatchId: 'm-alevin', teamId: ALEVIN,
                                   teamNames: { home: 'ALEVIN C', away: 'R1' } }));

    ok('1a · el puntero de la pestaña lleva el equipo en la clave',
       win.sessionStorage.getItem('cronos_tab_match' + '::' + ALEVIN) === 'm-alevin',
       JSON.stringify(Array.from(win.sessionStorage._mapa.entries())));

    // Cambia al Regional EN LA MISMA PESTAÑA.
    ctl.equipo = REGIONAL;

    ok('1b · 🔑 con el Regional abierto, la pestaña NO reclama el partido del Alevín',
       S.getTabMatchId() === '', JSON.stringify(S.getTabMatchId()));
    ok('1c · 🔑 y no se le ofrece retomar el del otro equipo',
       S.elegir() === null, JSON.stringify(S.elegir()));

    // Empieza el partido del Regional.
    S.setTabMatchId('m-regional');
    S.guardar('m-regional', estado({ liveMatchId: 'm-regional', teamId: REGIONAL,
                                     teamNames: { home: 'REGIONAL A', away: 'R2' } }));

    ok('1d · los dos partidos coexisten en el mismo dispositivo',
       S.leer('m-alevin') && S.leer('m-regional') &&
       S.leer('m-alevin').teamNames.home === 'ALEVIN C' &&
       S.leer('m-regional').teamNames.home === 'REGIONAL A');

    ok('1e · cada equipo tiene SU puntero, y el del Alevín sigue intacto',
       win.sessionStorage.getItem('cronos_tab_match::' + ALEVIN) === 'm-alevin' &&
       win.sessionStorage.getItem('cronos_tab_match::' + REGIONAL) === 'm-regional');

    // Volver al Alevín devuelve su partido, tal cual estaba.
    ctl.equipo = ALEVIN;
    const vuelta = S.elegir();
    ok('1f · 🔑 al volver al Alevín, su partido sigue ahí y es EL SUYO',
       vuelta && vuelta.id === 'm-alevin' && vuelta.esDeEstaPestana === true,
       JSON.stringify(vuelta && vuelta.id));

    // El inventario: filtrado para decidir, completo para el panel de rescate.
    ok('1g · listar(equipo) sólo ve el de ese equipo',
       S.listar(REGIONAL).length === 1 && S.listar(REGIONAL)[0].id === 'm-regional',
       JSON.stringify(S.listar(REGIONAL).map(x => x.id)));
    ok('1h · ⚠️ listar() SIN filtro los ve los dos (panel "Recuperar Partido")',
       S.listar().length === 2, JSON.stringify(S.listar().map(x => x.id)));

    // Terminar uno no puede tocar al otro (la garantía de v465, ahora por equipo).
    S.cerrar('m-alevin', true);
    ok('1i · terminar el Alevín deja intacto el Regional',
       S.leer('m-alevin') === null && S.leer('m-regional') !== null);
}

// ═══════════ PARTE 2 · un equipo no puede robar la ranura del otro ═══════════
console.log('\n── PARTE 2 · nadie reclama el partido ajeno ──');
{
    const LS = crearAlmacen();
    const { S, ctl } = abrirPestana(LS, ALEVIN);
    S.guardar('m-alevin', estado({ liveMatchId: 'm-alevin', teamId: ALEVIN }));
    S.setTabMatchId('m-alevin');

    ctl.equipo = REGIONAL;
    // Un latido tardío de la retransmisión del Alevín intenta reclamarlo.
    S.setTabMatchId('m-alevin');
    ok('2a · 🔑 el Regional NO acaba apuntando al partido del Alevín',
       S.getTabMatchId() === '', JSON.stringify(S.getTabMatchId()));

    // Y el autoguardado del Alevín sigue teniendo su ranura, aunque el panel
    // esté enseñando el Regional: se la pide POR EQUIPO.
    ok('2b · 🔑 el dueño puede seguir guardando en SU ranura desde el otro panel',
       S.slotIdActual('m-alevin', ALEVIN) === 'm-alevin');

    // Ranura provisional —el hueco entre "empieza el partido" y "startLiveSync
    // fija el id"—: también una por equipo. En una pestaña limpia, para que la
    // pruebe de verdad y no la resuelva un puntero ya escrito.
    const limpia = abrirPestana(crearAlmacen(), ALEVIN);
    const provAle = limpia.S.slotIdActual(null, ALEVIN);
    const provReg = limpia.S.slotIdActual(null, REGIONAL);
    ok('2c · ⚠️ la ranura PROVISIONAL también es por equipo (si no, el segundo pisa al primero)',
       provReg !== provAle && provReg.indexOf('tab:') === 0 && provAle.indexOf('tab:') === 0,
       provReg + ' / ' + provAle);
    limpia.S.guardar(provAle, estado({ teamId: ALEVIN, masterTimeH1: 11 }));
    limpia.S.guardar(provReg, estado({ teamId: REGIONAL, masterTimeH1: 22 }));
    ok('2d · y lo guardado en cada una NO se pisa',
       limpia.S.leer(provAle).masterTimeH1 === 11 && limpia.S.leer(provReg).masterTimeH1 === 22);
}

// ═══════════ PARTE 3 · ⚠️ EL AVISO DE LA CAPTURA 9042 ═══════════
// Se ejecuta `_guardAgainstMatchReset` de verdad, extraída de app-init.js.
console.log('\n── PARTE 3 · ⚠️ el aviso "hay un PARTIDO EN CURSO" ──');
{
    const iniG = APPINIT.indexOf('function _guardAgainstMatchReset');
    const finG = APPINIT.indexOf('window._guardAgainstMatchReset = _guardAgainstMatchReset;');
    if (iniG < 0 || finG < 0) {
        ok('3· no se pudo extraer _guardAgainstMatchReset de app-init.js', false);
    } else {
        const FUENTE_GUARD = APPINIT.slice(iniG, finG);

        function montarGuard(equipoAbierto) {
            const LS = crearAlmacen();
            const { win, S, ctl } = abrirPestana(LS, ALEVIN);
            // El Alevín, en 2ª parte y 1-0: exactamente la captura.
            S.guardar('m-alevin', estado({
                liveMatchId: 'm-alevin', teamId: ALEVIN,
                matchPhase: '2nd_half', masterTimeH1: 1800, masterTimeH2: 300,
                scoreHome: '1', scoreAway: '0',
            }));
            S.setTabMatchId('m-alevin');
            ctl.equipo = equipoAbierto;

            const avisos = [];
            win.confirm = (txt) => { avisos.push(txt); return true; };  // el usuario acepta
            win.confirm = win.confirm;
            const restauraciones = [];
            win.window._restoreActiveMatch = () => { restauraciones.push(win.window._cronosRestoreSlotId); };
            vm.runInContext('var _slots = () => window._cronosMatchSlots;\n' + FUENTE_GUARD, win);
            const veredicto = vm.runInContext('_guardAgainstMatchReset()', win);
            return { veredicto, avisos, restauraciones, S };
        }

        const conAlevin = montarGuard(ALEVIN);
        ok('3a · con el Alevín abierto SÍ avisa de su propio partido (2ª PARTE, 1-0)',
           conAlevin.avisos.length === 1 &&
           /2ª PARTE/.test(conAlevin.avisos[0]) && /1-0/.test(conAlevin.avisos[0]),
           JSON.stringify(conAlevin.avisos));
        ok('3b · y al aceptar retoma EXACTAMENTE esa ranura, no la que hubiera guardada antes',
           conAlevin.veredicto === true &&
           conAlevin.restauraciones.length === 1 && conAlevin.restauraciones[0] === 'm-alevin',
           JSON.stringify(conAlevin.restauraciones));

        const conRegional = montarGuard(REGIONAL);
        ok('3c · 🔑🔑🔑 CON EL REGIONAL ABIERTO NO SALE NINGÚN AVISO (captura 9042)',
           conRegional.avisos.length === 0,
           JSON.stringify(conRegional.avisos));
        ok('3d · 🔑 y el arranque del partido del Regional NO se aborta',
           conRegional.veredicto === false);
        ok('3e · ⚠️ el partido del Alevín NO se ha tocado: sigue entero en su ranura',
           conRegional.S.leer('m-alevin') !== null &&
           conRegional.S.leer('m-alevin').scoreHome === '1' &&
           conRegional.S.leer('m-alevin').masterTimeH2 === 300);

        // ⚠️ El perfil SIN equipo (entrenador individual, sin club) no tiene
        // teamId y no puede quedarse sin su aviso: para él nada ha cambiado.
        const LS = crearAlmacen();
        const solo = abrirPestana(LS, '');
        solo.S.guardar('m-solo', estado({
            liveMatchId: 'm-solo', matchPhase: 'break', scoreHome: '2', scoreAway: '2',
        }));
        solo.S.setTabMatchId('m-solo');
        const avisosSolo = [];
        solo.win.confirm = (t) => { avisosSolo.push(t); return false; };
        solo.win.window._restoreActiveMatch = () => {};
        vm.runInContext('var _slots = () => window._cronosMatchSlots;\n' + FUENTE_GUARD, solo.win);
        vm.runInContext('_guardAgainstMatchReset()', solo.win);
        ok('3f · ⚠️ sin equipo (entrenador individual) el aviso sigue saliendo igual que siempre',
           avisosSolo.length === 1 && /DESCANSO/.test(avisosSolo[0]),
           JSON.stringify(avisosSolo));
    }
}

// ═══════════ PARTE 4 · el autoguardado cae en la ranura del DUEÑO ═══════════
// Si el entrenador cambia de equipo con el partido a medias, ese partido sigue
// siendo del equipo anterior: no se puede perder ni acabar sellado con el otro.
console.log('\n── PARTE 4 · el autoguardado no cambia de equipo con el panel ──');
{
    const ini = APPINIT.indexOf('const _slots = () => window._cronosMatchSlots;');
    const fin = APPINIT.indexOf('window._saveMatchStateToStorage = _saveMatchStateToStorage;');
    if (ini < 0 || fin < 0) {
        ok('4· no se pudo extraer el autoguardado de app-init.js', false);
    } else {
        const FUENTE_SAVE = APPINIT.slice(ini, fin) +
                            'window._saveMatchStateToStorage = _saveMatchStateToStorage;';
        const LS = crearAlmacen();
        const { win, S, ctl } = abrirPestana(LS, ALEVIN);

        // Un DOM mínimo: sólo el marcador, que es lo que lee el autoguardado.
        const nodos = { 'score-home': { textContent: '3' }, 'score-away': { textContent: '1' } };
        win.document = { getElementById: (id) => nodos[id] || null };
        win.window.players = [{ id: 1, name: 'J1' }];
        vm.runInContext([
            'var matchPhase = "2nd_half";',
            'var isRunning = true;',
            'var masterTimeH1 = 1800, masterTimeH2 = 420;',
            'var half1MaxTime = 1800, half2MaxTime = 1800;',
            'var TEAM_NAMES = { home: "ALEVIN C", away: "RIVAL" };',
            'var currentMode = "f7";',
            'var COLORS = {};',
            'var liveMatchId = "m-alevin";',
            FUENTE_SAVE,
        ].join('\n'), win);

        // El partido nace con el Alevín abierto.
        vm.runInContext('window._cronosMatchTeamId = "' + ALEVIN + '"; _saveMatchStateToStorage();', win);
        ok('4a · el estado se guarda SELLADO con su equipo',
           S.leer('m-alevin') && S.leer('m-alevin').teamId === ALEVIN,
           JSON.stringify(S.leer('m-alevin') && S.leer('m-alevin').teamId));

        // El entrenador cambia al Regional SIN terminar el partido.
        ctl.equipo = REGIONAL;
        vm.runInContext('masterTimeH2 = 480; _saveMatchStateToStorage();', win);

        ok('4b · 🔑 sigue cayendo en la ranura del ALEVÍN, no en la del Regional',
           S.leer('m-alevin') !== null && S.leer('m-alevin').masterTimeH2 === 480,
           JSON.stringify(S.listar().map(x => x.id)));
        ok('4c · 🔑 y NO se le cambia el sello: el partido no se muda de equipo',
           S.leer('m-alevin').teamId === ALEVIN);
        ok('4d · ⚠️ el Regional no hereda ninguna ranura con datos del Alevín',
           S.listar(REGIONAL).filter(x => x.state.teamId === REGIONAL).length === 0,
           JSON.stringify(S.listar().map(x => x.id + ':' + x.state.teamId)));
    }
}

// ═══════════ PARTE 5 · un partido nuevo no hereda la retransmisión ═══════════
console.log('\n── PARTE 5 · el Regional no retransmite dentro del doc del Alevín ──');
{
    const ini = APPINIT.indexOf('function _cronosNuevoPartidoDeEquipo');
    const fin = APPINIT.indexOf('window._cronosNuevoPartidoDeEquipo = _cronosNuevoPartidoDeEquipo;');
    if (ini < 0 || fin < 0) {
        ok('5· no se pudo extraer _cronosNuevoPartidoDeEquipo de app-init.js', false);
    } else {
        const FUENTE_NUEVO = APPINIT.slice(ini, fin);
        // v558 · El entorno tiene que traer TODO el estado del partido: la
        // función ya no sólo suelta la retransmisión, también pone el partido a
        // cero (ver el guard test_partido_nuevo_y_eventos_aislados.js).
        function montar(equipoAbierto, dueñoPrevio, estadoPrevio) {
            const LS = crearAlmacen();
            const { win, ctl } = abrirPestana(LS, equipoAbierto);
            let cancelados = 0;
            win.clearInterval = () => { cancelados++; };
            const nodos = {
                'score-home': { textContent: '0' },
                'score-away': { textContent: '0' },
                'btn-play-pause': { textContent: 'PAUSAR', classList: { remove() {}, add() {} } },
            };
            win.document = { getElementById: (id) => nodos[id] || null };
            vm.runInContext([
                'var liveMatchId = "m-alevin";',
                'var liveIsActive = true;',
                'var liveSyncTimer = 7;',
                'var isRunning = false, timerInterval = null, lastTickTime = 0;',
                'var matchPhase = ' + JSON.stringify((estadoPrevio && estadoPrevio.matchPhase) || '1st_half') + ';',
                'var masterTimeH1 = ' + Number((estadoPrevio && estadoPrevio.masterTimeH1) || 0) + ';',
                'var masterTimeH2 = 0;',
                'var _slots = () => window._cronosMatchSlots;',
                'window._cronosMatchTeamId = ' + JSON.stringify(dueñoPrevio) + ';',
                'window._cronosMatchEvents = [{ t: "gol del alevin" }];',
                FUENTE_NUEVO,
                '_cronosNuevoPartidoDeEquipo();',
            ].join('\n'), win);
            return {
                id: vm.runInContext('liveMatchId', win),
                activo: vm.runInContext('liveIsActive', win),
                timer: vm.runInContext('liveSyncTimer', win),
                eventos: vm.runInContext('window._cronosMatchEvents', win),
                dueño: vm.runInContext('window._cronosMatchTeamId', win),
                cancelados,
                ctl,
            };
        }

        const cambia = montar(REGIONAL, ALEVIN);
        ok('5a · 🔑🔑🔑 al cambiar de equipo se SUELTA el liveMatchId (si no, los dos escriben el mismo documento)',
           cambia.id === null, JSON.stringify(cambia.id));
        ok('5b · ⚠️ y se corta el latido viejo EN EL ACTO (emitía la plantilla nueva al doc viejo)',
           cambia.activo === false && cambia.timer === null && cambia.cancelados === 1);
        ok('5c · los sucesos del partido anterior no se arrastran al nuevo',
           Array.isArray(cambia.eventos) && cambia.eventos.length === 0);
        ok('5d · el partido nuevo queda anotado como del equipo abierto',
           cambia.dueño === REGIONAL);

        // ⚠️ MISMO equipo Y sin nada jugado: es el entrenador que vuelve a
        // Configuración a los diez segundos y reconfirma la convocatoria. Eso
        // es el MISMO partido: soltar el id dejaría un documento 0-0 huérfano
        // en la lista de Partidos en Vivo.
        const mismo = montar(ALEVIN, ALEVIN, { matchPhase: '1st_half', masterTimeH1: 0 });
        ok('5e · ⚠️ con el MISMO equipo y sin nada jugado no se suelta la retransmisión',
           mismo.id === 'm-alevin' && mismo.activo === true && mismo.cancelados === 0 &&
           mismo.eventos.length === 1);

        const primero = montar(ALEVIN, '', { matchPhase: '1st_half', masterTimeH1: 0 });
        ok('5f · y el primer partido de la sesión tampoco se ve afectado',
           primero.id === 'm-alevin' && primero.dueño === ALEVIN);
    }
}

// ═══════════ PARTE 6 · migración en caliente y cableado ═══════════
console.log('\n── PARTE 6 · migración desde v556 y cableado ──');
{
    // ⚠️ Este despliegue puede caer con un partido EN JUEGO y la sesión ya
    // abierta: su puntero está en la clave SIN equipo.
    const LS = crearAlmacen();
    const { win, S, ctl } = abrirPestana(LS, ALEVIN);
    S.guardar('m-en-juego', estado({ liveMatchId: 'm-en-juego' }));   // sin sello: v556
    win.sessionStorage.setItem('cronos_tab_match', 'm-en-juego');     // puntero viejo

    ok('6a · 🔑 el partido en juego NO se pierde al actualizar la app',
       S.getTabMatchId() === 'm-en-juego');
    ok('6b · el puntero se muda a la clave del equipo y la vieja se retira',
       win.sessionStorage.getItem('cronos_tab_match::' + ALEVIN) === 'm-en-juego' &&
       win.sessionStorage.getItem('cronos_tab_match') === null);

    // Pero un partido ya sellado con OTRO equipo no se adopta jamás.
    const LS2 = crearAlmacen();
    const otra = abrirPestana(LS2, REGIONAL);
    otra.S.guardar('m-ajeno', estado({ liveMatchId: 'm-ajeno', teamId: ALEVIN }));
    otra.win.sessionStorage.setItem('cronos_tab_match', 'm-ajeno');
    ok('6c · ⚠️ un puntero viejo que apunta al partido de OTRO equipo no se adopta',
       otra.S.getTabMatchId() === '', JSON.stringify(otra.S.getTabMatchId()));
}

// Lo que no se puede ejecutar sin navegador se ancla lo más estrecho posible.
ok('6d · los DOS caminos de arranque declaran el equipo del partido nuevo',
   (IMPORTJS.match(/window\._cronosNuevoPartidoDeEquipo\(\)/g) || []).length >= 2,
   'goToTitularSelection y startMatchWithConvocation');

ok('6e · ⚠️ el cambio de equipo APARCA el partido antes de soltarlo (el autoguardado va a 5 s)',
   /_cronosCambiarEquipo = function[\s\S]{0,2600}_saveMatchStateToStorage\(\)[\s\S]{0,600}_cronosAplicarEquipoActivo\(teamId\)/.test(SETUP),
   'sin esto se pierden hasta 5 s de partido justo al cambiar');

ok('6f-bis · ⚠️ y sólo aparca si HAY partido (si no, cada cambio dejaría una ranura fantasma en "Recuperar Partido")',
   /if \(_habiaPartido && typeof window\._saveMatchStateToStorage === 'function'\)/.test(SETUP),
   'guardar a ciegas escribe una ranura nada más entrar, con el reloj a cero');

ok('6f · retomar un partido lleva de vuelta a SU equipo (pantalla y datos, lo mismo)',
   /_cronosAplicarEquipoActivo\(_eqPartido\)/.test(APPINIT) &&
   /window\._cronosAplicarEquipoActivo = function/.test(SETUP));

ok('6g · el panel de recuperación sigue partiendo de TODAS las ranuras',
   /_cronosMatchSlots \? window\._cronosMatchSlots\.listar\(\)/.test(SETUP),
   'filtrarlo por equipo dejaría el partido del otro irrecuperable');

// ═══════════ Resultado ═══════════
console.log('\n────────────────────────────────');
console.log('PASS: ' + pass + '   FAIL: ' + fail);
process.exit(fail === 0 ? 0 : 1);

// ─────────────────────────────────────────────────────────────────────────
// test_partido_nuevo_y_eventos_aislados.js · los DOS fallos de la prueba con
// 7 partidos simultáneos (captura 9043, v558)
//
//  A · EL SEGUNDO PARTIDO DE LA SESIÓN NO SE RETRANSMITÍA
//      "El partido del Cadete B no aparece en vivo, ni creándolo de nuevo".
//
//      🔑🔑🔑 NADIE PONÍA EL ESTADO A CERO AL EMPEZAR UN PARTIDO.
//      `spawnInitialPlayers()` reconstruye la plantilla, pero las variables
//      globales del partido (js/core/app-init.js) sólo las reiniciaba
//      `resetMatch()`, que es un BOTÓN con su propio confirm y no pasa por
//      aquí. Así que el partido nuevo heredaba el estado del anterior y
//      `matchPhase` seguía valiendo 'finished'. En cadena, y sin un solo error
//      visible:
//        · `pushLiveSnapshot` reutilizaba el `liveMatchId` del partido
//          terminado (`_isNewMatch = !liveMatchId`) y escribía sobre SU
//          documento, que las reglas de v434 tienen CONGELADO: la escritura se
//          deniega, el catch la deja en un warning y el partido no llega nunca
//          a `live_matches`;
//        · `_saveMatchStateToStorage` sale por su primera línea con
//          matchPhase 'finished': tampoco había recuperación local;
//        · `tick()` sólo suma en 1ª/2ª parte (v448): el cronómetro no correría;
//        · y el marcador es DOM puro: el partido nuevo empezaba con el
//          resultado del anterior en pantalla.
//
//  B · LOS SUCESOS DE UN PARTIDO SE COLABAN EN LA PANTALLA DE OTRO
//      Un cambio en el Alevín C salía con sonido y panel en las pantallas que
//      estaban viendo el Regional A, el Juvenil B y los demás.
//
//      La regla del autor: los eventos en vivo de un partido sólo se comunican
//      a los contactos del panel DE ESE EQUIPO y a su staff técnico autorizado
//      (director deportivo y coordinador del club). Jamás se cuelan en el
//      stream o la pantalla de otro equipo.
//
//      ⚠️ REVISA —NO REVIERTE— v455: en el LISTADO cada aviso sigue cayendo en
//      la pila de SU tarjeta (v466), que es lo que arregló que un gol en otro
//      campo no se anunciara jamás. Lo que se cierra es el DETALLE.
//
// ⚠️ SE EJECUTA EL CÓDIGO REAL: los bloques implicados se extraen de
// app-init.js y de live.html y se corren en un sandbox. Sólo el cableado que
// no se puede ejecutar sin navegador se ancla por fuente.
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

const APPINIT = fs.readFileSync(path.join(ROOT, 'js', 'core', 'app-init.js'), 'utf8');
const LIVE    = fs.readFileSync(path.join(ROOT, 'live.html'), 'utf8');
const SYNC    = fs.readFileSync(path.join(ROOT, 'js', 'match', 'live', 'sync.js'), 'utf8');
const RULES   = fs.readFileSync(path.join(ROOT, 'firestore.rules'), 'utf8');

console.log('── partido nuevo de verdad + eventos que no se cruzan (v558) ──\n');

// ═══════════════════════════════════════════════════════════════════════
//  PARTE 1 · ⚠️ EL PARTIDO NUEVO ARRANCA A CERO
// ═══════════════════════════════════════════════════════════════════════
console.log('── PARTE 1 · ⚠️ el segundo partido de la sesión (captura 9043) ──');
{
    const ini = APPINIT.indexOf('function _cronosNuevoPartidoDeEquipo');
    const fin = APPINIT.indexOf('window._cronosNuevoPartidoDeEquipo = _cronosNuevoPartidoDeEquipo;');
    if (ini < 0 || fin < 0) {
        ok('1· no se pudo extraer _cronosNuevoPartidoDeEquipo de app-init.js', false);
    } else {
        const FUENTE = APPINIT.slice(ini, fin);

        // Arranca un partido nuevo con el estado que dejó el anterior.
        function arrancar(previo) {
            const nodos = {
                'score-home':     { textContent: String(previo.scoreHome ?? '0') },
                'score-away':     { textContent: String(previo.scoreAway ?? '0') },
                'btn-play-pause': { textContent: 'PAUSAR', _clases: [],
                                    classList: { remove(c) { this._q = c; }, add() {} } },
            };
            let intervalosCancelados = 0;
            const sandbox = {
                console: { warn() {}, log() {}, error() {} },
                Number, String, parseInt, isNaN, Object, JSON, Date, Math, Array,
                clearInterval: () => { intervalosCancelados++; },
                setInterval: () => 1,
                document: { getElementById: (id) => nodos[id] || null },
            };
            sandbox.window = sandbox;
            sandbox.window._cronosMatchSlots = {
                equipoActual: () => previo.equipoAbierto || '',
            };
            vm.createContext(sandbox);
            vm.runInContext([
                'var _slots = () => window._cronosMatchSlots;',
                'var matchPhase   = ' + JSON.stringify(previo.matchPhase) + ';',
                'var isRunning    = ' + (previo.isRunning ? 'true' : 'false') + ';',
                'var timerInterval = 42;',
                'var lastTickTime = 123456;',
                'var masterTimeH1 = ' + Number(previo.masterTimeH1 || 0) + ';',
                'var masterTimeH2 = ' + Number(previo.masterTimeH2 || 0) + ';',
                'var liveMatchId  = ' + JSON.stringify(previo.liveMatchId ?? null) + ';',
                'var liveIsActive = true;',
                'var liveSyncTimer = 7;',
                'window._cronosMatchTeamId = ' + JSON.stringify(previo.dueño || '') + ';',
                'window._cronosMatchEvents = [{ t: "suceso del partido anterior" }];',
                'window._cronosLastDispatchedMatch = "informe-ya-enviado";',
                FUENTE,
                '_cronosNuevoPartidoDeEquipo();',
            ].join('\n'), sandbox);
            const leer = (expr) => vm.runInContext(expr, sandbox);
            return {
                matchPhase: leer('matchPhase'),
                isRunning:  leer('isRunning'),
                h1: leer('masterTimeH1'), h2: leer('masterTimeH2'),
                timerInterval: leer('timerInterval'),
                liveMatchId: leer('liveMatchId'),
                liveIsActive: leer('liveIsActive'),
                liveSyncTimer: leer('liveSyncTimer'),
                eventos: leer('window._cronosMatchEvents'),
                despacho: leer('window._cronosLastDispatchedMatch'),
                dueño: leer('window._cronosMatchTeamId'),
                extra: leer('window._cronosExtraGoals'),
                marcador: [nodos['score-home'].textContent, nodos['score-away'].textContent],
                boton: nodos['btn-play-pause'].textContent,
                intervalosCancelados,
            };
        }

        // ── El caso del reporte: se acaba de TERMINAR un partido 3-1 y se
        //    empieza otro con el mismo equipo.
        const tras = arrancar({
            matchPhase: 'finished', isRunning: false,
            masterTimeH1: 1800, masterTimeH2: 1800,
            scoreHome: '3', scoreAway: '1',
            liveMatchId: 'cadete-16082026-ab12-1830',
            dueño: 'cd-dia__cadete__b', equipoAbierto: 'cd-dia__cadete__b',
        });

        ok('1a · 🔑🔑🔑 la fase vuelve a 1ª PARTE (se quedaba en "finished")',
           tras.matchPhase === '1st_half', JSON.stringify(tras.matchPhase));
        ok('1b · 🔑🔑🔑 y se SUELTA el liveMatchId del partido terminado',
           tras.liveMatchId === null,
           'reutilizarlo escribe sobre un documento CONGELADO por las reglas: denegado y silencioso');
        ok('1c · el cronómetro vuelve a cero y parado',
           tras.h1 === 0 && tras.h2 === 0 && tras.isRunning === false && tras.timerInterval === null);
        ok('1d · ⚠️ y el MARCADOR también (vive sólo en el DOM: no lo pone a cero nadie más)',
           tras.marcador[0] === '0' && tras.marcador[1] === '0',
           JSON.stringify(tras.marcador));
        ok('1e · el botón vuelve a decir EMPEZAR',
           tras.boton === 'EMPEZAR', JSON.stringify(tras.boton));
        ok('1f · los goles no asignados del partido anterior no se arrastran',
           tras.extra && tras.extra.home === 0 && tras.extra.away === 0);
        ok('1g · ni sus sucesos ni su guard de despacho de informes',
           Array.isArray(tras.eventos) && tras.eventos.length === 0 && tras.despacho === null);
        ok('1h · y el latido de la retransmisión anterior se corta EN EL ACTO',
           tras.liveIsActive === false && tras.liveSyncTimer === null &&
           tras.intervalosCancelados >= 1);

        // ── Partido ABANDONADO (no terminado) con tiempo jugado: el usuario ha
        //    elegido "empezar de cero" en el aviso anti-reinicio.
        const abandonado = arrancar({
            matchPhase: '2nd_half', isRunning: true,
            masterTimeH1: 1800, masterTimeH2: 600,
            scoreHome: '0', scoreAway: '2',
            liveMatchId: 'alevin-16082026-cd34-1700',
            dueño: 'cd-dia__alevin__c', equipoAbierto: 'cd-dia__alevin__c',
        });
        ok('1i · un partido ABANDONADO con tiempo jugado tampoco se hereda',
           abandonado.liveMatchId === null && abandonado.matchPhase === '1st_half' &&
           abandonado.h1 === 0 && abandonado.marcador[1] === '0');

        // ── ⚠️ Y el caso que NO debe soltar el id: nada jugado, mismo equipo.
        //    Es el entrenador que vuelve a Configuración y reconfirma.
        const reconfirma = arrancar({
            matchPhase: '1st_half', isRunning: false,
            masterTimeH1: 0, masterTimeH2: 0,
            scoreHome: '0', scoreAway: '0',
            liveMatchId: 'alevin-16082026-cd34-1700',
            dueño: 'cd-dia__alevin__c', equipoAbierto: 'cd-dia__alevin__c',
        });
        ok('1j · ⚠️ reconfirmar sin nada jugado NO suelta el id (dejaría un 0-0 huérfano en la lista)',
           reconfirma.liveMatchId === 'alevin-16082026-cd34-1700' &&
           reconfirma.liveIsActive === true,
           JSON.stringify(reconfirma.liveMatchId));

        // ── Primer partido de la sesión: todo esto es una operación nula.
        const primero = arrancar({
            matchPhase: '1st_half', isRunning: false,
            masterTimeH1: 0, masterTimeH2: 0, scoreHome: '0', scoreAway: '0',
            liveMatchId: null, dueño: '', equipoAbierto: 'cd-dia__alevin__c',
        });
        ok('1k · en el primer partido de la sesión no cambia nada',
           primero.matchPhase === '1st_half' && primero.liveMatchId === null &&
           primero.dueño === 'cd-dia__alevin__c');
    }
}

// La cadena que hacía el daño invisible, anclada donde vive.
ok('1l · ⚠️ `_isNewMatch` sigue dependiendo de que liveMatchId esté vacío',
   /const\s+_isNewMatch\s*=\s*!liveMatchId/.test(SYNC),
   'si esto cambia, soltar el id deja de bastar para crear un partido nuevo');
ok('1m · ⚠️ las reglas siguen CONGELANDO el partido terminado (por eso no se puede reutilizar su doc)',
   /function lmIsLive\(\)/.test(RULES) && /lmIsLive\(\)\s*\|\|/.test(RULES),
   'es la razón por la que la escritura se denegaba en silencio');
ok('1n · ⚠️ el autoguardado sigue saliéndose con la fase "finished"',
   /if \(matchPhase === 'finished' \|\| matchPhase === 'idle'\) return;/.test(APPINIT),
   'por eso dejar la fase en finished también quitaba la recuperación local');

// ═══════════════════════════════════════════════════════════════════════
//  PARTE 2 · ⚠️ LOS EVENTOS NO SE CUELAN EN LA PANTALLA DE OTRO PARTIDO
// ═══════════════════════════════════════════════════════════════════════
console.log('\n── PARTE 2 · ⚠️ un partido no interrumpe la pantalla de otro ──');
{
    const ini = LIVE.indexOf('function _soyDestinatarioDe(m) {');
    const fin = LIVE.indexOf('// v455 · `matchId` (6º argumento) es el partido AL QUE PERTENECE el suceso.');
    if (ini < 0 || fin < 0 || fin < ini) {
        ok('2· no se pudieron extraer las puertas de live.html', false);
    } else {
        const FUENTE = LIVE.slice(ini, fin);

        const ALEVIN   = { id: 'm-alevin',   clubId: 'cd-dia', createdBy: 'uid-ana',  coachEmail: 'ana@x.com' };
        const REGIONAL = { id: 'm-regional', clubId: 'cd-dia', createdBy: 'uid-luis', coachEmail: 'luis@x.com' };
        const DE_OTRO_CLUB = { id: 'm-otro', clubId: 'otro-club', createdBy: 'uid-z', coachEmail: 'z@x.com' };

        function juez(quien, dondeEstoy) {
            const sandbox = {
                console: { warn() {}, log() {} }, String, Object,
                userData: quien,
                currentMatchId: dondeEstoy.viendo || null,
                _matchLastData: { 'm-alevin': ALEVIN, 'm-regional': REGIONAL, 'm-otro': DE_OTRO_CLUB },
                _avisosEnListado: () => !!dondeEstoy.enListado,
            };
            sandbox.window = sandbox;
            vm.createContext(sandbox);
            vm.runInContext(FUENTE, sandbox);
            return (matchId) => vm.runInContext('_puedeAvisarme(' + JSON.stringify(matchId) + ')', sandbox);
        }

        // ── EL CASO REPORTADO: Luis está viendo el Regional A y la entrenadora
        //    del Alevín C hace un cambio.
        const luisEnRegional = juez(
            { uid: 'uid-luis', email: 'luis@x.com', role: 'user', clubId: 'cd-dia' },
            { viendo: 'm-regional', enListado: false });
        ok('2a · 🔑🔑🔑 viendo el Regional, un suceso del ALEVÍN no avisa (captura 9043)',
           luisEnRegional('m-alevin') === false);
        ok('2b · y el del partido que sí está viendo, claro que sí',
           luisEnRegional('m-regional') === true);

        // Ni siquiera el director, que sí es destinatario del Alevín, se lleva
        // la interrupción mientras está DENTRO de otro partido.
        const directorEnRegional = juez(
            { uid: 'uid-dir', email: 'dir@x.com', role: 'director', clubId: 'cd-dia' },
            { viendo: 'm-regional', enListado: false });
        ok('2c · 🔑 ni al director le salta el Alevín mientras mira el Regional',
           directorEnRegional('m-alevin') === false);

        // ── EN EL LISTADO se conserva v455/v466: cada aviso, en su tarjeta.
        const directorEnListado = juez(
            { uid: 'uid-dir', email: 'dir@x.com', role: 'director', clubId: 'cd-dia' },
            { viendo: null, enListado: true });
        ok('2d · ⚠️ en el LISTADO el director sí se entera de TODOS sus equipos (v455 sigue en pie)',
           directorEnListado('m-alevin') === true && directorEnListado('m-regional') === true);
        ok('2e · pero no de los partidos de OTRO club',
           directorEnListado('m-otro') === false);

        const coordEnListado = juez(
            { uid: 'uid-coord', email: 'c@x.com', role: 'coordinator', clubId: 'cd-dia' },
            { viendo: null, enListado: true });
        ok('2f · el coordinador del club, igual que el director (la regla los nombra a los dos)',
           coordEnListado('m-alevin') === true && coordEnListado('m-regional') === true);

        // ── El ENTRENADOR, en el listado, sólo lo suyo.
        const luisEnListado = juez(
            { uid: 'uid-luis', email: 'luis@x.com', role: 'user', clubId: 'cd-dia' },
            { viendo: null, enListado: true });
        ok('2g · 🔑 en el listado, el entrenador del Regional NO recibe los sucesos del Alevín',
           luisEnListado('m-alevin') === false);
        ok('2h · y sí los del partido que lleva él',
           luisEnListado('m-regional') === true);
        // Reconocido también por email, no sólo por uid: un partido creado
        // desde otra cuenta del mismo entrenador sigue siendo suyo.
        const porEmail = juez(
            { uid: 'otro-uid', email: 'ANA@x.com', role: 'user', clubId: 'cd-dia' },
            { viendo: null, enListado: true });
        ok('2i · el entrenador se reconoce también por su correo, sin distinguir mayúsculas',
           porEmail('m-alevin') === true);

        // ── El PADRE entra con enlace directo a UN partido: ese sí le avisa.
        const padre = juez(
            { uid: 'uid-padre', email: 'p@x.com', role: 'parent', clubId: 'cd-dia' },
            { viendo: 'm-alevin', enListado: false });
        ok('2j · ⚠️ el padre sigue recibiendo los avisos del partido de su hijo',
           padre('m-alevin') === true);
        ok('2k · y ninguno de los demás equipos del club',
           padre('m-regional') === false);

        // ── El SuperAdmin supervisa, y respeta su filtro de club.
        const sa = juez({ uid: 'uid-sa', email: 's@x.com', role: 'superadmin' },
                        { viendo: null, enListado: true });
        ok('2l · el SuperAdmin recibe todo en el listado',
           sa('m-alevin') === true && sa('m-otro') === true);

        // ── Una llamada SIN matchId (las antiguas) se comporta como siempre.
        ok('2m · ⚠️ un aviso sin partido declarado no se silencia (llamadas antiguas)',
           luisEnRegional(undefined) === true && luisEnRegional(null) === true);
    }
}

// El cableado: la puerta tiene que estar en la PRIMERA línea de showEventToast,
// porque el destello, el sonido y la vibración están AL FINAL de esa función.
const iToast = LIVE.indexOf('function showEventToast(type, line, sub, matchTime, equipo, matchId) {');
const cabezaToast = iToast < 0 ? '' : LIVE.slice(iToast, iToast + 420);
ok('2n · ⚠️ la puerta va ANTES de todo en showEventToast (el sonido está al final)',
   /if \(!_puedeAvisarme\(matchId\)\) return;/.test(cabezaToast),
   'filtrar más abajo dejaría sonando el aviso ajeno');

ok('2o · playEventSound y la vibración siguen DENTRO de showEventToast (los corta la misma puerta)',
   /playEventSound\(type\);[\s\S]{0,120}vibrate\(meta\.vib\)/.test(LIVE));

const iFase = LIVE.indexOf('function _handlePhaseTransition(matchId, matchData) {');
const bloqueFase = iFase < 0 ? '' : LIVE.slice(iFase, iFase + 2200);
ok('2p · ⚠️ el silbato y el overlay de FINAL pasan por la misma puerta',
   /_puedeAvisarme\(matchId\)/.test(bloqueFase) &&
   bloqueFase.indexOf('_matchPrevPhase[matchId] = nextPhase;') < bloqueFase.indexOf('_puedeAvisarme(matchId)'),
   'la fase se sigue anotando; lo que no se hace es anunciarla');

ok('2q · el aviso del LISTADO sigue yendo a la pila de SU tarjeta (v466 intacto)',
   /_pilaPorTarjeta = \(_enListado && matchId\)/.test(LIVE));

// ═══════════════════════════════════════════════════════════════════════
console.log('\n────────────────────────────────');
console.log('PASS: ' + pass + '   FAIL: ' + fail);
process.exit(fail === 0 ? 0 : 1);

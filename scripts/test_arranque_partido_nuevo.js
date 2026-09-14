// ═══════════════════════════════════════════════════════════════════════════
//  GUARD · v714 · EL ARRANQUE DE UN PARTIDO NUEVO NO PUEDE BLOQUEAR NADA
// ═══════════════════════════════════════════════════════════════════════════
//  Encargo del autor (implementar.txt 2026-09-14, captura 10409):
//
//    «Al crear un partido amistoso o fuera de casa (especialmente con tiempos
//     personalizados cortos, como 1 minuto), el cronómetro y los botones de
//     inicio/reanudación se quedan completamente congelados y bloqueados. El
//     sistema salta errores de permisos y sincronización en Firestore al
//     intentar limpiar o registrar los eventos iniciales».
//
//  📏 LO QUE SE MIDIÓ ANTES DE TOCAR NADA (scripts/ops/inspect_live_matches.js,
//  sólo lectura, contra producción): la colección `live_matches` entera tenía
//  TRES documentos de esa mañana —11:14, 12:31 y 13:56— y **ninguno era el
//  partido de la captura (13:50)**. Los tres que sí existen llevan el reloj
//  corrido (H1 00:30, 00:52, 02:49 sobre topes de 01:00), o sea que ahí el
//  cronómetro funcionó. El partido bloqueado es justo el que NO tiene
//  documento: los «errores de permisos» no eran un aviso inofensivo, eran la
//  señal de que el documento no llegó a existir.
//
//  CUATRO DEFECTOS, y los cuatro se pueden reintroducir por separado:
//
//   A · LAS DOS ESCRITURAS DEL ARRANQUE ESTABAN CONDENADAS. Un partido nuevo
//       hacía `updateDoc({events: []})` sobre un documento que no existe —y
//       las reglas contestan «Missing or insufficient permissions», no
//       «not-found», porque evaluar `resource.data` nulo LANZA— y luego
//       `setDoc({events: []})`, que `allow create` DENIEGA por no llevar
//       ninguna de las tres llaves de pertenencia. Ahora se crea el documento
//       CON sus llaves, en una escritura que las reglas admiten.
//
//   B · «REINICIAR» APAGABA EL DIRECTO PARA SIEMPRE. `resetMatch` llamaba a
//       `stopLiveSync()` y no volvía a encenderlo; como los envíos de
//       `toggleGame` cuelgan de `if (liveIsActive)`, el partido reiniciado se
//       jugaba entero sin transmitir. Y un partido reiniciado es un partido
//       NUEVO: le toca un id nuevo, no el del anterior.
//
//   C · EL RELOJ NO PUEDE CONGELARSE POR UN FALLO DE PINTADO. `tick` corre en
//       un `setInterval`: una excepción en el optimizador de pintado, en una
//       ficha o en el envío se llevaba por delante TODO lo que venía detrás
//       —incluido el auto-fin de la parte— y dejaba la pantalla clavada
//       mientras el partido seguía corriendo por dentro. Eso es «congelado».
//
//   D · Y NO SE ADOPTA LA PAUSA DE UN DOCUMENTO QUE NO PODEMOS ESCRIBIR. El
//       mecanismo de v638 (manda el servidor) da por supuesto que nuestros
//       latidos llegan; cuando no llegan, el documento conserva el
//       `isRunning:false` anterior a la pulsación y se la devuelve al
//       entrenador cada 5 s. Desde fuera: «le doy a REANUDAR y no responde».
// ═══════════════════════════════════════════════════════════════════════════
'use strict';

const fs   = require('fs');
const path = require('path');
const vm   = require('vm');

const RAIZ = path.join(__dirname, '..');
const leer = f => fs.readFileSync(path.join(RAIZ, f), 'utf8');

let fallos = 0, total = 0;
function ok(nombre, cond, detalle) {
    total++;
    if (cond) console.log('  ✓ ' + nombre);
    else {
        console.log('  ✗ ' + nombre);
        if (detalle !== undefined) console.log('      ' + String(detalle).slice(0, 400));
        fallos++;
    }
}

function trozo(src, desde) {
    const ini = src.indexOf(desde);
    if (ini < 0) return null;
    let i = src.indexOf('{', ini), prof = 0;
    if (i < 0) return null;
    for (; i < src.length; i++) {
        if (src[i] === '{') prof++;
        else if (src[i] === '}') { prof--; if (prof === 0) { i++; break; } }
    }
    return src.slice(ini, i);
}

// ⚠️ SIN COMENTARIOS. Estas aserciones miden CÓDIGO, y en este proyecto los
// comentarios citan por su nombre lo que explican: la 2c nació EN VERDE FALSO
// porque mi propia nota escribía «liveMatchId = null» al explicarlo, así que la
// mutación que borraba la línea de verdad no se cazaba. Misma trampa que en
// v711 (test_individual_reports_module) y v713 (report-engine 1c).
const sinComentarios = (s) => String(s || '').replace(/^\s*\/\/.*$/gm, '');

const SYNC   = leer('js/match/live/sync.js');
const TIMER  = leer('js/match/timer/core.js');
const MOVLOG = leer('js/match/events/movement-log.js');
const APPINI = leer('js/core/app-init.js');
const REGLAS = leer('firestore.rules');

// ═══════════════════════════════════════════════════════════════════════════
console.log('\n── PARTE 1 · [A] el partido nuevo nace con sus llaves ──');
// ═══════════════════════════════════════════════════════════════════════════
{
    const zona = SYNC.slice(SYNC.indexOf('if (_isNewMatch) {'),
                            SYNC.indexOf('// Guardar el snapshot inicial'));
    ok('1a · se encuentra el bloque de arranque de partido nuevo', zona.length > 300);

    ok('1b · 🔑🔑 [A] ya NO se intenta el updateDoc sobre un documento inexistente',
       !/updateDoc\(doc\(fa\.db, 'live_matches', liveMatchId\), \{ events: \[\] \}\)/.test(zona),
       'ese updateDoc es el «Missing or insufficient permissions» de la captura');
    ok('1c · 🔑🔑 [A] ni el setDoc mínimo que allow create DENIEGA siempre',
       !/setDoc\(doc\(fa\.db, 'live_matches', liveMatchId\), \{ events: \[\] \}, \{ merge: true \}\)/.test(zona),
       'un payload sin clubId/createdBy/coachEmail no pasa las reglas');

    ok('1d · 🔑 la creación lleva las TRES llaves de pertenencia y el estado',
       /createdBy:\s*_u\.uid/.test(zona) && /coachEmail:\s*_u\.email/.test(zona) &&
       /clubId:\s*_u\.clubId/.test(zona) && /status:\s*'active'/.test(zona),
       'sin ellas, las reglas no pueden autorizar ni la creación ni las lecturas');
    ok('1e · 🔑 y deja `events` limpio, que es lo que pedía v265',
       /events:\s*\[\]/.test(zona));
    ok('1f · ⚠️ si aun así falla, se avisa y el partido se juega igual',
       /No se pudo inicializar el partido en la nube/.test(zona) &&
       /console\.warn/.test(zona),
       'el reloj no puede depender de Firestore');

    // La rama de las reglas que esto aprovecha, citada para que el guard se
    // ponga rojo si alguien la cambia sin mirar aquí.
    ok('1g · 📏 la regla que lo admite sigue en firestore.rules (clubId + autor)',
       /allow create: if isAuth\(\) && \(/.test(REGLAS) &&
       /request\.resource\.data\.get\('createdBy', null\) == request\.auth\.uid/.test(REGLAS),
       'si esta rama desaparece, el arranque vuelve a nacer sin documento');
}

// ═══════════════════════════════════════════════════════════════════════════
console.log('\n── PARTE 2 · [B] reiniciar vuelve a encender el directo ──');
// ═══════════════════════════════════════════════════════════════════════════
{
    const fnCrudo = trozo(MOVLOG, 'function resetMatch()');
    const fn = sinComentarios(fnCrudo);
    ok('2a · se encuentra resetMatch', !!fnCrudo);
    if (fnCrudo) {
        ok('2b · 🔑🔑 [B] tras cerrar el anterior, vuelve a arrancar la transmisión',
           /startLiveSync\(\)/.test(fn),
           'antes llamaba a stopLiveSync y el partido reiniciado no transmitía nada');
        ok('2c · 🔑 y lo hace como partido NUEVO (id nuevo), no reclamando el viejo',
           /liveMatchId = null/.test(fn),
           'sin soltar el id, el reinicio escribiría encima del partido anterior');
        ok('2d · ⚠️ el id se suelta DESPUÉS del cierre, o el último latido del ' +
           'partido viejo se va sin escribir',
           fn.indexOf('stopLiveSync') >= 0 && fn.indexOf('liveMatchId = null') > fn.indexOf('stopLiveSync'));
        ok('2e · sólo se reenciende si estaba en vivo',
           /_estabaEnVivo/.test(fn) && /if \(_estabaEnVivo\)/.test(fn));
        ok('2f · y un fallo al reanudar no tumba el reinicio',
           /catch \(e\)[\s\S]{0,120}No se pudo reanudar la transmisión/.test(fn));
    }

    // La pieza que hacía que el silencio fuera total: los envíos del botón
    // cuelgan de liveIsActive.
    const tg = trozo(TIMER, 'function toggleGame()');
    ok('2g · 📏 [B] los envíos del botón siguen colgando de liveIsActive ' +
       '(por eso apagarlo callaba el partido entero)',
       !!tg && /if \(liveIsActive\) pushLiveSnapshot/.test(tg));
}

// ═══════════════════════════════════════════════════════════════════════════
console.log('\n── PARTE 3 · [C] el tick, EJECUTADO con un pintado que revienta ──');
// ═══════════════════════════════════════════════════════════════════════════
{
    const fn = trozo(TIMER, 'function tick()');
    ok('3a · se encuentra tick', !!fn);

    // Arnés: un tick con 1 segundo transcurrido, fase 1ª parte, un jugador en
    // campo y el pintado del cronómetro LANZANDO. Antes, esa excepción se
    // llevaba por delante el resto del tick.
    const montar = (opciones) => {
        const o = opciones || {};
        const ctx = {
            console: { warn() {}, log() {}, error() {} },
            Date, Math, window: {},
            matchPhase: '1st_half',
            masterTimeH1: 0, masterTimeH2: 0,
            half1MaxTime: 60, half2MaxTime: 60,     // el minuto por parte del autor
            currentMode: 'f11',
            lastTickTime: Date.now() - 1000,
            liveIsActive: true,
            _pintadoCrono: 0, _pintadoFicha: 0, _sincronizado: 0, _finParte: 0,
            players: [{ id: 1, status: 'field', time: 0 }, { id: 2, status: 'bench', time: 0 }],
        };
        ctx.updateMasterUI   = () => { ctx._pintadoCrono++; if (o.cronoRevienta) throw new Error('pintado del crono'); };
        ctx.updatePlayerUI   = () => { ctx._pintadoFicha++; if (o.fichaRevienta) throw new Error('pintado de la ficha'); };
        ctx.syncTimerWithServer = () => { ctx._sincronizado++; if (o.syncRevienta) throw new Error('sync'); };
        ctx._arrancarVigiaReloj = () => {};
        ctx.window.endFirstHalf = () => { ctx._finParte++; };
        ctx.window.endMatch     = () => { ctx._finParte++; };
        vm.createContext(ctx);
        vm.runInContext('let _lastServerSync = 0;\nconst _SERVER_SYNC_INTERVAL_MS = 5000;\n' +
                        fn + ';\n;globalThis.tick = tick;', ctx);
        return ctx;
    };

    if (fn) {
        const sano = montar({});
        sano.tick();
        ok('3b · con todo sano: el reloj suma, se pinta y se sincroniza',
           sano.masterTimeH1 === 1 && sano._pintadoCrono === 1 &&
           sano._pintadoFicha === 1 && sano._sincronizado === 1,
           JSON.stringify({ t: sano.masterTimeH1, c: sano._pintadoCrono, f: sano._pintadoFicha }));
        ok('3c · y sólo cuenta el tiempo de quien está EN CAMPO',
           sano.players[0].time === 1 && sano.players[1].time === 0);

        const crono = montar({ cronoRevienta: true });
        let murio = false;
        try { crono.tick(); } catch (e) { murio = true; }
        ok('3d · 🔑🔑 [C] si el pintado del cronómetro revienta, el tick NO muere',
           !murio, 'la excepción escapaba del setInterval');
        ok('3e · 🔑🔑 y el resto del tick se ejecuta: fichas y sincronización',
           crono.masterTimeH1 === 1 && crono._pintadoFicha === 1 && crono._sincronizado === 1,
           JSON.stringify({ t: crono.masterTimeH1, f: crono._pintadoFicha, s: crono._sincronizado }));

        const ficha = montar({ fichaRevienta: true });
        murio = false;
        try { ficha.tick(); } catch (e) { murio = true; }
        ok('3f · 🔑 si revienta la ficha de un jugador, tampoco',
           !murio && ficha.masterTimeH1 === 1 && ficha._sincronizado === 1);
        ok('3g · 🔑 y ese jugador NO pierde sus minutos por no poder pintarse',
           ficha.players[0].time === 1, ficha.players[0].time);

        const sync = montar({ syncRevienta: true });
        murio = false;
        try { sync.tick(); } catch (e) { murio = true; }
        ok('3h · y si revienta el envío, el reloj sigue sin enterarse',
           !murio && sync.masterTimeH1 === 1 && sync._pintadoCrono === 1);

        // 🔑 [C] El auto-fin de parte vive al FINAL del tick: con el pintado
        // roto, antes no se llegaba nunca. Con un minuto por parte y el
        // añadido de F11 (900 s), el tope es 960.
        const fin = montar({ cronoRevienta: true });
        fin.masterTimeH1 = 960;
        fin.lastTickTime = Date.now() - 1000;
        fin.tick();
        ok('3i · 🔑🔑 [C] el auto-fin de la parte se evalúa aunque el pintado falle',
           fin._finParte === 1, 'era lo último del tick y la excepción lo saltaba');

        ok('3j · ⚠️ el aviso del fallo no se repite cada segundo',
           /_cronosTickFallo/.test(fn), 'un warn por tick llenaría la consola');
    }
}

// ═══════════════════════════════════════════════════════════════════════════
console.log('\n── PARTE 4 · [D] un documento desfasado no devuelve la pausa ──');
// ═══════════════════════════════════════════════════════════════════════════
{
    const pieza = trozo(TIMER, 'function _mandaLaPulsacionLocal()');
    const fn    = trozo(TIMER, 'function _adoptarMarchaDelServidor(servidorCorre)');
    ok('4a · se encuentran las dos piezas de la adopción', !!pieza && !!fn);

    if (pieza && fn) {
        const montar = (estado) => {
            const ctx = {
                console: { warn() {}, log() {} }, Date,
                isRunning: estado.isRunning,
                timerInterval: null, lastTickTime: 0,
                clearInterval: () => {}, setInterval: () => 1, tick: () => {},
                document: { getElementById: () => ({ classList: { add() {}, remove() {} }, textContent: '' }) },
                window: {
                    _cronosUltimoToggleLocal: estado.toggle || 0,
                    _cronosUltimoLatidoOk:    estado.latido || 0,
                },
            };
            vm.createContext(ctx);
            vm.runInContext('const _GRACIA_PULSACION_MS = 8000;\n' + pieza + '\n' + fn +
                            ';\n;globalThis.adoptar = _adoptarMarchaDelServidor;' +
                            'globalThis.manda = _mandaLaPulsacionLocal;', ctx);
            return ctx;
        };
        const ahora = Date.now();

        // Caso v638 intacto: dos aparatos sincronizados, latidos llegando.
        const sano = montar({ isRunning: true, toggle: ahora - 60000, latido: ahora - 1000 });
        sano.adoptar(false);
        ok('4b · ⚠️ v638 SIGUE EN PIE: con los latidos llegando, manda el servidor',
           sano.isRunning === false, 'si esto se rompe, pausar en la tablet deja de funcionar');

        // El defecto: acabo de pulsar y mis escrituras no llegan.
        const reciente = montar({ isRunning: true, toggle: ahora - 500, latido: 0 });
        reciente.adoptar(false);
        ok('4c · 🔑🔑 [D] recién pulsado, el servidor NO puede devolver la pausa',
           reciente.isRunning === true, 'es el «le doy a REANUDAR y no responde»');

        const incomunicado = montar({ isRunning: true, toggle: ahora - 30000, latido: ahora - 120000 });
        incomunicado.adoptar(false);
        ok('4d · 🔑🔑 [D] y si el último latido BUENO es anterior a la pulsación, ' +
           'el documento es un espejo desfasado: tampoco',
           incomunicado.isRunning === true,
           'sin documento (lo MEDIDO) el panel se peleaba con su propio dueño cada 5 s');

        const alDia = montar({ isRunning: true, toggle: ahora - 30000, latido: ahora - 2000 });
        alDia.adoptar(false);
        ok('4e · 🔑 pero un latido POSTERIOR a la pulsación sí da autoridad al servidor',
           alDia.isRunning === false, 'así dos tablets siguen convergiendo');

        const sinPulsar = montar({ isRunning: false, toggle: 0, latido: 0 });
        sinPulsar.adoptar(true);
        ok('4f · sin ninguna pulsación local, se adopta como siempre',
           sinPulsar.isRunning === true);
    }

    ok('4g · 🔑 el sello del latido bueno se pone DESPUÉS de la escritura',
       SYNC.indexOf("await setDoc(doc(fa.db, 'live_matches', liveMatchId), snapshot, { merge: true })") <
       SYNC.indexOf('window._cronosUltimoLatidoOk = Date.now()'),
       'si se sella antes, un fallo de escritura contaría como latido bueno');
    ok('4h · y el de la pulsación, en toggleGame',
       /window\._cronosUltimoToggleLocal = Date\.now\(\)/.test(TIMER));
}

// ═══════════════════════════════════════════════════════════════════════════
console.log('\n── PARTE 5 · la pestaña RECLAMA el partido que retoma ──');
// ═══════════════════════════════════════════════════════════════════════════
{
    const zona = APPINI.slice(APPINI.indexOf('if (state.liveMatchId && matchPhase !== '),
                              APPINI.indexOf('if (state.liveMatchId && matchPhase !== ') + 1200);
    ok('5a · se encuentra la reactivación del directo al retomar', zona.length > 200);
    ok('5b · 🔑 reclama la ranura de la pestaña, como startLiveSync (v465)',
       /setTabMatchId\(liveMatchId\)/.test(zona),
       'sin esto, la puerta estanca de v469 bloquea todos los latidos en silencio');
    ok('5c · 📏 y la puerta estanca sigue ahí (es la que bloqueaba)',
       /Latido BLOQUEADO/.test(SYNC));
}

console.log('\n  ' + (total - fallos) + '/' + total + ' aserciones');
if (fallos) { console.log('  ' + fallos + ' FALLOS'); process.exit(1); }

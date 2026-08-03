// ─────────────────────────────────────────────────────────────────────────
// test_modal_deferred_events.js · Confirmación diferida del modal y
// sustituciones como UN solo suceso (implementar.txt, 2026-07-31).
//
// 1. CONFIRMACIÓN DIFERIDA. Cada pulsación del modal (gol, tarjeta, lesión)
//    emitía su aviso AL INSTANTE: un doble clic o una rectificación mandaban un
//    aviso falso al visor en vivo que ya no se podía retirar. Ahora los eventos
//    se APARCAN mientras el modal está abierto y al pulsar HECHO se emite sólo
//    la DIFERENCIA NETA contra el estado que tenía el jugador al abrirlo.
//    ⚠️ HECHO es la ÚNICA salida del modal (index.html no tiene ✕ ni cierre por
//    fondo), así que "cerrar sin confirmar" es en la práctica RECTIFICAR.
//
// 2. SUSTITUCIONES UNIFICADAS. Cada cambio emitía DOS eventos sueltos
//    ('CAMBIO · Entra · X' y 'CAMBIO · Sale · Y') que llegaban al visor como
//    líneas desarticuladas. Ahora es UN evento:
//        [Equipo] | ▲ SALE: [saliente] | ▼ ENTRA: [entrante]
//    ⚠️ ▲ ROJA = SALE y ▼ VERDE = ENTRA. Desde v424 es la convención ÚNICA de
//    toda la app: hasta v423 el cronograma de informes (report-engine.js) usaba
//    la contraria y el autor decidió unificar con ésta. Si se vuelve a tocar,
//    hay que tocar también report-engine.js, individual-reports.js y
//    collective-report.js — y este test lo comprueba en 3b-bis.
//
// 3. Y el volcado de JSON crudo del historial: los eventos `tactical_move`
//    guardan JSON.stringify({playerId, x, y, …}) como texto. Son TELEMETRÍA de
//    posiciones para el replay, no sucesos. Se siguen emitiendo —el replay
//    depende de ellos— pero el visor ya no los pinta.
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
const leer = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8').replace(/\r\n/g, '\n');
const sinCom = (s) => s.split('\n').map(l => l.replace(/^\s*\/\/.*$/, '')).join('\n');

console.log('── Modal: confirmación diferida · Cambios: un solo suceso ──\n');

const ACT  = leer('js/match/events/player-actions.js');
const DRAG = leer('js/ui/drag-drop.js');
const REND = leer('js/ui/render.js');
const LIVE = leer('live.html');

// ═══════ PARTE 1 · 🔑 la lógica del diff, ejercitada ═══════
// Se carga el bloque de confirmación diferida en un sandbox con un
// _registerMatchEvent falso, y se reproducen las secuencias reales de pulsación.
console.log('── PARTE 1 · 🔑 sólo se emite la diferencia neta ──');
{
    const ini = ACT.indexOf('var _modalStaging  = false;');
    const fin = ACT.indexOf('function openPlayerActionModal');
    const emitidos = [];
    const sb = {
        players: [],
        console: { log() {}, warn() {} },
        _registerMatchEvent: function (type, text) { emitidos.push(type); }
    };
    vm.createContext(sb);
    vm.runInContext(ACT.slice(ini, fin) +
        '\nthis.__conf = _confirmarEventosModal; this.__desc = _descartarEventosModal;' +
        '\nthis.__set = function(st, base, buf){ _modalStaging = st; _modalBaseline = base; _modalBuffer = buf; };', sb);

    // Escenario: jugador que empieza sin goles, sin tarjeta y sano.
    const jugador = (over) => Object.assign({ id: 'p1', goals: 0, cards: 'ninguna', injured: false }, over || {});
    const base = { id: 'p1', goals: 0, cards: 'ninguna', injured: false };

    const correr = (estadoFinal, buffer) => {
        emitidos.length = 0;
        sb.players = [jugador(estadoFinal)];
        sb.__set(true, base, buffer);
        sb.__conf();
        return emitidos.slice();
    };

    // 🔑 EL CASO DEL AUTOR: doble clic en +1 y luego rectificar con −1.
    ok('1a · 🔑 +1 y luego −1 gol → NO se emite nada',
       correr({ goals: 0 }, [['goal', 'GOL · X', '⚽']]).length === 0);

    ok('1b · 🔑 +1 +1 −1 → se emite UN solo gol',
       JSON.stringify(correr({ goals: 1 }, [['goal', 'GOL · X', '⚽'], ['goal', 'GOL · X', '⚽']])) === '["goal"]');

    ok('1c · un gol de verdad sí se emite',
       JSON.stringify(correr({ goals: 1 }, [['goal', 'GOL · X', '⚽']])) === '["goal"]');

    ok('1d · dos goles de verdad, dos avisos',
       correr({ goals: 2 }, [['goal', 'GOL · X', '⚽'], ['goal', 'GOL · X', '⚽']]).length === 2);

    // Tarjetas: si al final la tarjeta es la misma que al abrir, no hubo cambio.
    ok('1e · 🔑 roja y luego revertida → NO se emite nada',
       correr({ cards: 'ninguna' }, [['red', 'TARJETA ROJA · X', '🟥']]).length === 0);
    ok('1f · una roja que se queda sí se emite',
       JSON.stringify(correr({ cards: 'roja' }, [['red', 'TARJETA ROJA · X', '🟥']])) === '["red"]');
    ok('1g · doble amarilla: se emiten las dos mitades de la secuencia',
       correr({ cards: 'roja' },
              [['yellow', 'AMARILLA · X', '🟨'], ['red', 'ROJA · X (doble amarilla)', '🟥']]).length === 2);

    // Lesión: sólo si pasa de sano a lesionado.
    ok('1h · 🔑 lesión marcada y desmarcada → NO se emite nada',
       correr({ injured: false }, [['injury', 'LESIÓN · X', '🚑']]).length === 0);
    ok('1i · una lesión que se queda sí se emite',
       JSON.stringify(correr({ injured: true }, [['injury', 'LESIÓN · X', '🚑']])) === '["injury"]');

    // Robustez.
    ok('1j · sin buffer no se emite nada', correr({}, []).length === 0);
    ok('1k · si el jugador ya no existe, no se emite ni se lanza', (() => {
        try {
            emitidos.length = 0;
            sb.players = [];
            sb.__set(true, base, [['goal', 'GOL', '⚽']]);
            sb.__conf();
            return emitidos.length === 0;
        } catch (_) { return false; }
    })());
    ok('1l · descartar vacía el buffer sin emitir', (() => {
        emitidos.length = 0;
        sb.players = [jugador({ goals: 1 })];
        sb.__set(true, base, [['goal', 'GOL', '⚽']]);
        sb.__desc();
        sb.__conf();
        return emitidos.length === 0;
    })());
}

// ═══════ PARTE 2 · el aparcado y su única salida ═══════
console.log('\n── PARTE 2 · nada sale del modal hasta HECHO ──');
{
    const a = sinCom(ACT);
    // El buffer arrastra también `extra` (los campos estructurados), o al
    // confirmar se perderían y el replay volvería a depender del texto.
    // v434 · La tupla lleva ahora un 6º elemento, `target` (el partido destino),
    // porque _confirmarEventosModal la reenvía con apply: sin él, un evento
    // aparcado perdería el destino al emitirse y volvería a caer en la global
    // liveMatchId. El regex admite comentarios entre el `if` y el push.
    ok('2a · 🔑 con el modal abierto, _registerMatchEvent aparca en vez de emitir',
       /if \(_modalStaging\) \{[\s\S]{0,400}?_modalBuffer\.push\(\[type, text, icon, matchTimeOverride, extra, target\]\);\s*return;\s*\}/.test(a),
       (a.match(/if \(_modalStaging\)[\s\S]{0,160}/) || ['(no aparece)'])[0]);
    ok('2b · 🔑 abrir el modal fotografía el estado inicial',
       /_modalBaseline = \{[\s\S]{0,200}?goals: player\.goals[\s\S]{0,120}?cards: player\.cards/.test(a));
    ok('2c · 🔑 y activa el aparcado', /_modalStaging = true;/.test(a));
    ok('2d · 🔑 HECHO (closePlayerActionModal) es lo que confirma y emite',
       /function closePlayerActionModal\(\)[\s\S]{0,220}?_confirmarEventosModal\(\);/.test(a));
    ok('2e · el botón HECHO del modal sigue llamando a closePlayerActionModal',
       /onclick="closePlayerActionModal\(\)"[^>]*>HECHO</.test(leer('index.html')) ||
       /HECHO/.test(leer('index.html')) && /onclick="closePlayerActionModal\(\)"/.test(leer('index.html')));
    ok('2f · existe una vía de descarte por si se añade otra salida al modal',
       /function _descartarEventosModal\(\)/.test(a));
}

// ═══════ PARTE 3 · 🔑 la sustitución es UN solo suceso ═══════
console.log('\n── PARTE 3 · un cambio, un evento ──');
{
    const a = sinCom(ACT), d = sinCom(DRAG), r = sinCom(REND);

    ok('3a · 🔑 existe el emisor unificado de sustitución',
       /window\._registerSubstitution = function \(outPlayer, inPlayer\)/.test(a));
    // ⚠️ CONVENCIÓN v424: ▲ = SALE, ▼ = ENTRA, unificada en TODA la app.
    // Es el tercer juego de glifos que se prueba y el definitivo:
    //   🔺🔻 (hasta v417) — AMBOS ROJOS en Unicode, no se distinguían.
    //   🟥🟩 (v418-v423)  — contrastan, pero son Unicode 12 (2019) y en móviles
    //                       con fuentes anteriores salían como rombo negro y '?'.
    //   ▲▼   (v424)      — Unicode 1.1, existen en todas las fuentes, y al ser
    //                       neutros el color lo pone el CSS del visor.
    ok('3b · 🔑 con el formato pedido: equipo, SALE y ENTRA en una línea',
       /equipo \+ ' \| ▲ SALE: ' \+ outName \+ ' \| ▼ ENTRA: ' \+ inName/.test(a),
       (a.match(/SALE[^\n]*/) || ['(no aparece)'])[0]);
    // Y que NO vuelvan los glifos que ya se descartaron.
    ok('3b-bis · 🔑 no quedan 🟥/🟩 ni 🔺/🔻 en el emisor de sustituciones',
       !/[🟥🟩🔺🔻]\s*(SALE|ENTRA):/.test(a));
    ok('3c · y se emite como UN evento de tipo sub',
       /_registerMatchEvent\('sub',/.test(a));
    ok('3d · el nombre del equipo sale de TEAM_NAMES, con respaldo',
       /TEAM_NAMES\[t\]/.test(a) && /VISITANTE/.test(a) && /LOCAL/.test(a));

    // 🔑 ESTA ASERCIÓN DECÍA LO CONTRARIO Y ERA ELLA LA QUE FIJABA LA
    // DUPLICACIÓN: exigía que render.js emitiera la sustitución. Pero
    // handleSmartSwap(), que se llama justo antes, YA la registra vía
    // logMovement con el mismo subId — así que emitir aquí la duplicaba, y el
    // autor veía cada cambio dos veces en el toast y dos en el historial.
    // Ahora se exige justo lo contrario: render.js NO emite.
    ok('3e · 🔑 el cambio en grupo NO emite: handleSmartSwap ya lo registra',
       !/_registerSubstitution\(/.test(r) &&
       !/_registerMatchEvent\('sub/.test(r) &&
       /handleSmartSwap\(outPlayer, inPlayer, forcedSubId\)/.test(r),
       (r.match(/_register[^\n]*/) || ['(no emite: correcto)'])[0]);
    // v425: las dos mitades siguen compartiendo subId, pero ahora cada llamada
    // lleva ADEMÁS el estado previo del jugador (3er argumento), para que
    // logMovement pueda descartar un movimiento que no cambia nada.
    ok('3e-bis · 🔑 y handleSmartSwap registra las dos mitades con el MISMO subId',
       /const subId = forcedSubId \|\| Date\.now\(\);[\s\S]{0,200}?logMovement\(dragged, subId, [^)]+\);[\s\S]{0,120}?logMovement\(target,  subId, [^)]+\);/.test(sinCom(DRAG)),
       (sinCom(DRAG).match(/const subId = forcedSubId[\s\S]{0,240}/) || ['(no aparece)'])[0]);
    ok('3f · 🔑 y el arrastre empareja las dos mitades por subId',
       /window\._registerSubHalf\(player, subId, action\)/.test(d) &&
       !/_registerMatchEvent\('sub_in'/.test(d));
    // 🔑 EL MOVIMIENTO SUELTO ES LA MAYORÍA DE LOS CASOS: sólo 3 de las 9
    // llamadas a logMovement pasan subId. Si ésas emitieran el formato viejo
    // ('CAMBIO · Sale · X'), el historial mezclaría dos estilos y seguirían
    // viéndose las líneas desarticuladas que el autor pidió eliminar.
    ok('3g · sin subId no se pierde el suceso: se emite suelto',
       /if \(!subId\) \{[\s\S]{0,700}?_registerMatchEvent\(/.test(a));
    ok('3g-bis · 🔑 y con el MISMO formato limpio, no el "CAMBIO · Sale ·" de antes',
       /eq \+ ' \| ▼ ENTRA: ' \+ nombre/.test(a) &&
       /eq \+ ' \| ▲ SALE: ' \+ nombre/.test(a),
       (a.match(/if \(!subId\)[\s\S]{0,400}/) || ['(no aparece)'])[0]);
    ok('3g-ter · 🔑 ya no queda NINGÚN "CAMBIO · Entra/Sale ·" en el emisor',
       !/'CAMBIO · ' \+ action/.test(a) && !/CAMBIO · Entra/.test(a) && !/CAMBIO · Sale/.test(a),
       (a.match(/CAMBIO ·[^\n]*/) || ['(limpio)'])[0]);
    ok('3h · el emparejado sólo emite cuando tiene las DOS mitades',
       /if \(slot\.in && slot\.out\)/.test(a));

    // 🔑 Ejercitar el emparejado de verdad.
    const ini = ACT.indexOf('var _subsPendientes = {};');
    const fin = ACT.indexOf('function _registerMatchEvent');
    const emitidos = [];
    const sb = {
        console: { log() {}, warn() {} },
        TEAM_NAMES: { home: 'ARINAGA', away: 'RIVAL' },
        _registerMatchEvent: (type, text, icon, mt, extra) => emitidos.push({ type, text, extra }),
        window: {}
    };
    sb.window._registerSubstitution = null;
    vm.createContext(sb);
    // _registerSubstitution vive antes; se carga junto con el emparejado.
    const iniS = ACT.indexOf('function _nombreEquipoDe');
    vm.runInContext(ACT.slice(iniS, fin), sb);

    const salir = { name: 'IVÁN', team: 'home' };
    const entrar = { name: 'LUIS', team: 'home' };
    sb.window._registerSubHalf(salir, 'C1', 'Sale');
    ok('3i · 🔑 con sólo una mitad NO se emite nada todavía', emitidos.length === 0,
       JSON.stringify(emitidos));
    sb.window._registerSubHalf(entrar, 'C1', 'Entra');
    ok('3j · 🔑 al llegar la segunda mitad se emite UN evento', emitidos.length === 1,
       JSON.stringify(emitidos));
    ok('3k · 🔑 con el formato exacto pedido por el autor',
       emitidos[0] && emitidos[0].text === 'ARINAGA | ▲ SALE: IVÁN | ▼ ENTRA: LUIS',
       emitidos[0] && emitidos[0].text);
    ok('3l · y de tipo sub', emitidos[0] && emitidos[0].type === 'sub');

    // 🔑 CAMPOS ESTRUCTURADOS: el reproductor de repeticiones sacaba el nombre
    // del jugador PARSEANDO el texto del evento. Reformatear las sustituciones
    // —algo puramente visual— le dejaba de encontrar los jugadores y las
    // sustituciones desaparecían de la repetición sin error alguno. Con estos
    // campos, el texto puede cambiar sin romper nada que dependa de los datos.
    ok('3l-bis · 🔑 el evento unificado lleva los DOS nombres en campos propios',
       emitidos[0] && emitidos[0].extra &&
       emitidos[0].extra.subOutName === 'IVÁN' && emitidos[0].extra.subInName === 'LUIS',
       JSON.stringify(emitidos[0] && emitidos[0].extra));

    // Y el movimiento suelto lleva el suyo.
    emitidos.length = 0;
    sb.window._registerSubHalf({ name: 'SOLO', team: 'away' }, null, 'Sale');
    ok('3l-ter · 🔑 el movimiento suelto también lleva su playerName',
       emitidos.length === 1 && emitidos[0].extra && emitidos[0].extra.playerName === 'SOLO',
       JSON.stringify(emitidos[0]));
    ok('3l-quater · y con el formato limpio, no el "CAMBIO ·" de antes',
       emitidos[0] && emitidos[0].text === 'RIVAL | ▲ SALE: SOLO',
       emitidos[0] && emitidos[0].text);

    // Dos cambios simultáneos no se mezclan entre sí.
    emitidos.length = 0;
    sb.window._registerSubHalf({ name: 'A', team: 'home' }, 'C1', 'Sale');
    sb.window._registerSubHalf({ name: 'B', team: 'home' }, 'C2', 'Sale');
    sb.window._registerSubHalf({ name: 'D', team: 'home' }, 'C2', 'Entra');
    sb.window._registerSubHalf({ name: 'C', team: 'home' }, 'C1', 'Entra');
    ok('3m · 🔑 dos cambios a la vez se emparejan por su propio subId, sin mezclarse',
       emitidos.length === 2 &&
       emitidos[0].text.includes('SALE: B') && emitidos[0].text.includes('ENTRA: D') &&
       emitidos[1].text.includes('SALE: A') && emitidos[1].text.includes('ENTRA: C'),
       JSON.stringify(emitidos.map(e => e.text)));
}

// ═══════ PARTE 4 · sin JSON crudo en el historial ═══════
console.log('\n── PARTE 4 · la telemetría táctica no se pinta ──');
{
    const l = sinCom(LIVE);
    ok('4a · 🔑 hay una lista de tipos que no se muestran',
       /_TIPOS_NO_VISIBLES = new Set\(\['tactical_move'\]\)/.test(l));
    ok('4b · 🔑 la criba de anuncios los descarta',
       /if \(!_esEventoVisible\(ev\)\) return;/.test(l));
    ok('4c · 🔑 y el listado del historial también',
       (l.match(/if \(!_esEventoVisible\(ev\)\) return;/g) || []).length >= 2,
       'apariciones: ' + (l.match(/if \(!_esEventoVisible\(ev\)\) return;/g) || []).length);
    ok('4d · 🔑 pero se SIGUEN emitiendo: el replay táctico depende de ellos',
       /_registerMatchEvent\('tactical_move'/.test(sinCom(DRAG)));
}

console.log(`\n${pass} PASS / ${fail} FAIL`);
process.exit(fail ? 1 : 0);

// ─────────────────────────────────────────────────────────────────────────
// test_live_event_dedup.js · Visor en vivo: cada evento UNA vez, y cero cruce
// entre partidos simultáneos (implementar.txt, 2026-07-31).
//
// LOS DOS FALLOS VISTOS EN PRODUCCIÓN con dos partidos a la vez (Alevín C de
// 'arinagazone' y Juvenil B de 'DamasoRV'):
//   1. BUCLE INFINITO DE GOLES: al marcar el primer gol, el visor lo cantaba y
//      añadía la línea al historial CADA 5 SEGUNDOS, indefinidamente.
//   2. CRUCE ENTRE PARTIDOS: los sucesos de un partido salían en el visor del
//      otro.
//
// 🔑 LA CAUSA DEL BUCLE, y por qué el arreglo es de raíz: los avisos NO se
// leían de una lista de eventos, se DEDUCÍAN comparando el estado del snapshot
// anterior con el nuevo. El emisor reescribe el documento cada ~5 s (latido),
// así que en cuanto el estado previo se perdía por cualquier vía, cada latido
// parecía un gol nuevo. Ahora cada evento lleva `eventId` y el visor lleva un
// registro de vistos POR matchId: un evento anunciado dos veces es imposible.
//
// RESPALDO POR DELTA (decisión del autor): los eventos escritos ANTES de este
// fix no tienen eventId. Para ellos se deriva una clave de timestamp+texto, y
// si el partido no emite ningún eventId se conserva la detección por delta de
// siempre — así un partido ya en curso no se queda sin avisos.
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

console.log('── Visor en vivo: dedup por eventId y aislamiento por partido ──\n');

const LIVE = leer('live.html');
const ACTIONS = leer('js/match/events/player-actions.js');

// ═══════ PARTE 1 · el emisor pone identidad ═══════
console.log('── PARTE 1 · cada evento nace con su eventId ──');
{
    const a = sinCom(ACTIONS);
    const bloque = a.slice(a.indexOf('function _registerMatchEvent'),
                           a.indexOf('window._cronosMatchEvents.push'));
    ok('1a · 🔑 el evento lleva eventId', /eventId:/.test(bloque), bloque.slice(-300));
    ok('1b · 🔑 y también su matchId, para poder descartarlo si no es del partido',
       /matchId:\s*_evMatchId/.test(bloque));
    ok('1c · el id se compone de tiempo + sufijo aleatorio (único por evento)',
       /now\.getTime\(\)\.toString\(36\)/.test(bloque) && /Math\.random\(\)/.test(bloque));
    ok('1d · se conservan los campos que ya usaba el visor',
       /timestamp:/.test(bloque) && /realTime:/.test(bloque) && /matchTime:/.test(bloque));

    // El id se calcula UNA vez y viaja en el documento; no se re-deriva.
    ok('1e · 🔑 el eventId se escribe dentro del objeto que va a Firestore',
       /arrayUnion\(eventEntry\)/.test(a));
}

// ═══════ PARTE 2 · el visor procesa cada evento UNA vez ═══════
console.log('\n── PARTE 2 · registro de vistos por partido ──');
{
    const l = sinCom(LIVE);
    ok('2a · 🔑 hay un registro de eventos vistos POR matchId',
       /const _matchSeenEvents = \{\}/.test(l));
    ok('2b · y una función que devuelve el Set de ese partido',
       /function _seenSetFor\(matchId\)/.test(l));
    ok('2c · 🔑 un evento ya visto NO se vuelve a procesar',
       /if \(!k \|\| _vistos\.has\(k\)\) return;/.test(l));
    ok('2d · 🔑 el registro se limpia al dejar de seguir un partido',
       /delete _matchSeenEvents\[id\];/.test(l));
    ok('2e · y al reabrir un partido, para que la siembra no cante el historial',
       /delete _matchSeenEvents\[matchId\];/.test(l));

    // 🔑 La primera pasada marca todo como visto SIN anunciar.
    ok('2f · 🔑 en la siembra se marcan los eventos SIN anunciarlos',
       /if \(!_siembra\) _evNuevos\.push\(ev\);/.test(l));
}

// ═══════ PARTE 3 · 🔑 comportamiento real del deduplicador ═══════
console.log('\n── PARTE 3 · 🔑 el bucle es imposible (prueba de la lógica) ──');
{
    // Se extraen las funciones puras del visor y se ejercitan con el escenario
    // real: el MISMO snapshot llegando una y otra vez (el latido de 5 s).
    const l = LIVE;
    const ini = l.indexOf('const _matchSeenEvents = {};');
    const fin = l.indexOf('window.toggleMute');
    const sb = { console: { log() {}, warn() {} } };
    vm.createContext(sb);
    vm.runInContext(l.slice(ini, fin) +
        '\nthis.__k = _eventKey; this.__s = _seenSetFor; this.__b = _eventBelongsTo;' +
        '\nthis.__store = _matchSeenEvents;', sb);

    // ⚠️ Las fixtures llevan el matchId del partido contra el que se prueban: la
    // primera versión reutilizaba un evento de 'M1' contra 'M2' y el filtro de
    // aislamiento lo descartaba — rojo por la razón equivocada, aunque de paso
    // demostró que el filtro funciona.
    const golDe = (mid, id, text) => ({
        eventId: id, matchId: mid, type: 'goal',
        text: text || '⚽ GOL - IVÁN', timestamp: '2026-07-31T10:00:00.000Z'
    });
    const gol = golDe('M1', 'ev_abc');

    // Simula la criba del visor: devuelve los eventos NUEVOS de esa pasada.
    const pasada = (matchId, eventos, siembra) => {
        const vistos = sb.__s(matchId);
        const nuevos = [];
        eventos.forEach(ev => {
            if (!sb.__b(ev, matchId)) return;
            const k = sb.__k(ev);
            if (!k || vistos.has(k)) return;
            vistos.add(k);
            if (!siembra) nuevos.push(ev);
        });
        return nuevos;
    };

    ok('3a · la siembra no anuncia nada', pasada('M1', [gol], true).length === 0);

    // 🔑 EL ESCENARIO DEL FALLO: el mismo gol llegando 20 veces (100 segundos
    // de latidos). Debe anunciarse EXACTAMENTE una vez.
    sb.__store['M2'] = undefined;
    const golM2 = golDe('M2', 'ev_abc');
    let anuncios = 0;
    for (let i = 0; i < 20; i++) anuncios += pasada('M2', [golM2], false).length;
    ok('3b · 🔑 20 latidos con el MISMO gol → se anuncia UNA sola vez',
       anuncios === 1, 'anuncios: ' + anuncios);

    // Un gol distinto sí se anuncia, y el anterior sigue sin repetirse.
    const gol2 = golDe('M2', 'ev_xyz', '⚽ GOL - LUIS');
    ok('3c · un gol NUEVO sí se anuncia', pasada('M2', [golM2, gol2], false).length === 1);

    // 🔑 AISLAMIENTO: un evento que declara otro partido no entra jamás.
    const ajeno = { eventId: 'ev_otro', matchId: 'M9', type: 'goal', text: '⚽ GOL - AJENO' };
    ok('3d · 🔑 un evento de OTRO partido no se procesa aunque llegue aquí',
       pasada('M2', [ajeno], false).length === 0);

    // 🔑 Y los registros de dos partidos simultáneos son independientes: el
    // mismo id en dos partidos se anuncia en cada uno, sin interferir.
    sb.__store['A'] = undefined; sb.__store['B'] = undefined;
    const nA = pasada('A', [{ eventId: 'ev_1', type: 'goal', text: 'x' }], false).length;
    const nB = pasada('B', [{ eventId: 'ev_1', type: 'goal', text: 'x' }], false).length;
    ok('3e · 🔑 dos partidos simultáneos llevan registros independientes',
       nA === 1 && nB === 1, 'A=' + nA + ' B=' + nB);

    // — RESPALDO PARA EVENTOS ANTIGUOS —
    const viejo = { type: 'goal', text: '⚽ GOL - ANTIGUO', timestamp: '2026-07-30T09:00:00.000Z' };
    sb.__store['L'] = undefined;
    let vAnuncios = 0;
    for (let i = 0; i < 5; i++) vAnuncios += pasada('L', [viejo], false).length;
    ok('3f · 🔑 un evento SIN eventId también se deduplica, por timestamp+texto',
       vAnuncios === 1, 'anuncios: ' + vAnuncios);
    ok('3g · y su clave se marca como heredada', /^legacy\|/.test(sb.__k(viejo)), sb.__k(viejo));
    ok('3h · un evento sin ningún dato no genera clave (no se procesa)',
       sb.__k({}) === '');
    ok('3i · un evento antiguo SIN matchId se acepta (viene en el doc del partido)',
       sb.__b(viejo, 'L') === true);
}

// ═══════ PARTE 4 · el delta queda como respaldo ═══════
console.log('\n── PARTE 4 · el delta sólo para partidos sin eventId ──');
{
    const l = sinCom(LIVE);
    // ⚠️ El `return` se ancla JUSTO tras el bucle de anuncios. Una ventana laxa
    // encontraba un `return;` posterior del código de delta y dejaba pasar la
    // mutación que quitaba el corte — o sea, el doble aviso (evento + delta).
    ok('4a · 🔑 si el partido emite eventos con id, se anuncia por evento y SE SALE',
       /showEventToast\(_t,[\s\S]{0,200}?\}\);\s*return;/.test(l),
       (l.match(/showEventToast\(_t,[\s\S]{0,240}/) || ['(no aparece)'])[0]);
    ok('4b · 🔑 y _evConId se calcula mirando si ALGÚN evento trae eventId',
       /const _evConId = _evArr\.some\(e => e && e\.eventId\)/.test(l));
    ok('4c · el delta de siempre sigue ahí, detrás, para el caso heredado',
       /_metaWithTime/.test(l) && /const subPending = \[\]/.test(l));
    // v424: el texto pasa por _formateaLineaEvento —el formateador ÚNICO— y ya
    // no sólo cuando es un cambio. Antes aquí sólo se coloreaban las
    // sustituciones y el resto salía con el texto crudo; ese "texto crudo" era
    // justo el segundo formato con el que el mismo gol aparecía repetido en el
    // historial. El minuto sigue saliendo del propio evento.
    // v445: la llamada admite un 5º argumento con el equipo de la incidencia,
    // así que el cierre del paréntesis deja de ir pegado al minuto. Se fija lo
    // mismo que antes —texto y minuto salen del PROPIO evento— sin exigir que
    // no haya más argumentos.
    ok('4d · 🔑 el aviso por evento usa el texto y el minuto del propio evento',
       /showEventToast\(_t, _linea, matchLabel, ev\.matchTime \|\| _matchTime[,)]/.test(l) &&
       /_linea = _formateaLineaEvento\(_t, ev\.text \|\| ''\)/.test(l),
       (l.match(/showEventToast\(_t[^\n]*/) || ['(no aparece)'])[0]);
    ok('4d2 · v445 · y le pasa el EQUIPO del propio evento (+ el matchId, v455)',
       /showEventToast\(_t, _linea, matchLabel, ev\.matchTime \|\| _matchTime,\s*_equipoDeSuceso\(matchData, ev\), matchId\)/.test(l),
       'el campo `team` del evento es la fuente fiable; deducirlo es el respaldo');
    ok('4e · 🔑 y las sustituciones se colorean: verde ENTRA, rojo SALE',
       /ENTRA:\[\^\|\]\*\)/.test(l.replace(/\\/g, '')) || /_coloreaSustitucion/.test(l));
}

// ═══════ PARTE 5 · aislamiento por partido, lo que ya existía ═══════
console.log('\n── PARTE 5 · aislamiento por matchId ──');
{
    const l = sinCom(LIVE);
    // ⚠️ INVERTIDA EN v455. Fijaba el filtro de v274 —`if (m.id !== currentMatchId)
    // return;`— que arreglaba un problema real (los sucesos de un partido se
    // colaban en el CAJÓN de otro) pero cortando por lo sano: dejaba de procesar
    // los demás partidos, así que un gol en otro campo NO se anunciaba JAMÁS. Con
    // dos partidos en curso, el director sólo se enteraba de uno.
    // La separación correcta es POR DESTINO, y la decide showEventToast con el
    // matchId que recibe: aviso flotante global, cajón del partido visible.
    ok('5a · [INVERTIDA v455] el watcher de fondo procesa TODOS los partidos',
       !/if \(m\.id !== currentMatchId\) return;/.test(l),
       'ese return dejaba los avisos pegados al último partido abierto');
    ok('5b · 🔑 y la criba de eventos filtra además por el matchId del evento',
       /if \(!_eventBelongsTo\(ev, matchId\)\) return;/.test(l));
    ok('5c · los mapas de estado siguen estando indexados por matchId',
       /const _matchPrevState = \{\}/.test(l) && /const _matchLastTs = \{\}/.test(l));
    ok('5d · la suscripción principal escucha un ÚNICO documento',
       /onSnapshot\(\s*doc\(db, 'live_matches', matchId\)/.test(l));
}

// ═══════ PARTE 6 · v440 · YA NO HAY PANEL INFERIOR QUE CERRAR ═══════
// ⚠️ PARTE INVERTIDA, Y ES LA QUINTA VEZ QUE PASA EN ESTE PROYECTO: fijaba que
// la barra inferior de HISTORIAL se auto-expandiera 5 segundos con cada suceso
// y se cerrara sola (v228, a petición del autor de entonces). En v440 el autor
// pidió RETIRAR esa barra: era GLOBAL —una sola para toda la aplicación, fija
// al pie y por encima de cualquier pantalla—, así que en el listado, con varios
// partidos en curso, no se sabía de cuál hablaba.
//
// La intención se conserva: que los sucesos no se pierdan y que el mecanismo
// que los pinta siga siendo uno solo. Lo que cambia es DÓNDE: el cajón vive
// ahora dentro del banquillo del partido (#match-events-box). El resto de este
// fichero —el dedup, que es lo que de verdad protege— no se toca.
console.log('\n── PARTE 6 · el panel inferior flotante ya no existe ──');
{
    const l = sinCom(LIVE).replace(/<!--[\s\S]*?-->/g, '');
    ok('6a · 🔑 no queda rastro del panel fijo al pie de la pantalla',
       !/id="match-events-panel"/.test(l) && !/match-events-strip/.test(l),
       (l.match(/[^\n]*match-events-panel[^\n]*/) || ['(limpio)'])[0]);
    ok('6b · ni su maquinaria de expandir/contraer',
       !/_setMatchEventsPanelMode/.test(l) && !/_matchEventsPanelMode/.test(l) &&
       !/_matchEventsAutoCollapseTimer/.test(l),
       (l.match(/[^\n]*_matchEventsPanelMode[^\n]*/) || ['(limpio)'])[0]);
    // v442: la lista sale del banquillo (allí era ilegible, 200px de ancho) y
    // vuelve a ser una barra inferior. Lo que hay que seguir fijando NO es
    // dónde está, sino que no sea GLOBAL: se enciende con renderMatch y se
    // apaga al salir del detalle.
    ok('6c · 🔑 la barra de sucesos sólo existe dentro del detalle de un partido',
       /_mostrarBarraSucesos\(true\)/.test(l) && /_mostrarBarraSucesos\(false\)/.test(l) &&
       /<div id="match-events-bar" style="display:none;">/.test(l),
       'en el listado no puede haber barra: era el defecto de la barra global');
    ok('6d · y la lista conserva su id, que es de lo que cuelgan las dos vías',
       /id="match-events-list"/.test(l));
    ok('6e · 🔑 sigue habiendo UN solo sitio donde se añade una fila nueva',
       (l.match(/function _appendEventToHistoryPanel/g) || []).length === 1);
    ok('6f · el cajón no flota: no lleva position fixed ni anclaje al pie',
       !/#match-events-box\s*\{[^}]*position:\s*fixed/.test(l) &&
       !/#match-events-box\s*\{[^}]*bottom:\s*0/.test(l));
    // Anclado al MANEJADOR de "Limpiar", no a la distancia desde su id: entre
    // uno y otro se coló el manejador del plegado (v442) y la ventana fija de
    // caracteres se quedó corta, dando rojo por la razón equivocada.
    ok('6g · "Limpiar" sobrevive y vacía TAMBIÉN el registro del dedup',
       /clear\.addEventListener\('click'[\s\S]{0,600}?_histVistos = new Set\(\)/.test(l),
       'sin eso, tras limpiar el siguiente snapshot no repintaría nada: todo contaría como ya visto');
}

console.log(`\n${pass} PASS / ${fail} FAIL`);
process.exit(fail ? 1 : 0);

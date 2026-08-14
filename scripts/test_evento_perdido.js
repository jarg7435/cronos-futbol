// ═══════════════════════════════════════════════════════════════════════════
//  EVENTOS PERDIDOS — v531  (implementar.txt del 2026-08-14)
// ═══════════════════════════════════════════════════════════════════════════
//  Tres fallos que reportó el autor sobre "Registrar Evento Perdido":
//
//  1 · MÓVIL · los jugadores de campo y banquillo salían MEZCLADOS en un único
//      <select> plano cuyo texto acaba en "(Campo)"/"(Banquillo)". En PC e iPad
//      el desplegable se ve entero; en el móvil el <select> nativo se abre como
//      RUEDA del sistema y recorta el texto por la derecha — justo el sufijo que
//      dice dónde está el jugador. De ahí su "selector extraño".
//      Además, en el CAMBIO los dos desplegables ofrecían la MISMA lista, y la
//      etiqueta del primero decía "Jugador que Sale (Banquillo)" cuando el que
//      sale está en el campo.
//
//  2 · INFORMES · lo retroactivo se marcaba pegando "(Retroactivo)" AL TEXTO, y
//      el modal no tocaba el historial del jugador, así que el evento no llegaba
//      al cronograma del informe individual. Hace falta marca ESTRUCTURADA y
//      entrada en el historial, con su minuto, para pintarlo en NARANJA.
//
//  3 · PARTIDOS TERMINADOS · la lista salía de `window.players` (los jugadores
//      del partido cargado EN MEMORIA), no del partido destino. En un partido
//      terminado esa lista viene vacía y sólo quedaba la opción "Gol del Rival":
//      por eso "parecía que sólo dejaba actuar con el gol del rival".
//
//  🔑 La forma de los datos se leyó POR REST de un partido terminado real
//  (doramas-7-14082026-d4k8-1337) antes de escribir nada:
//    · `players[]` NO lleva `history` en live_matches (vive en el informe);
//    · `number` es CADENA ("1") y `id` es NÚMERO → comparar con String();
//    · el marcador vive en `homeTeam.score` / `awayTeam.score`;
//    · `isRetroactive:true` YA existe en el evento (player-actions.js:203).
// ═══════════════════════════════════════════════════════════════════════════

'use strict';

const fs   = require('fs');
const path = require('path');
const vm   = require('vm');

const RAIZ = path.join(__dirname, '..');
const SRC_MODAL  = fs.readFileSync(process.env.CRONOS_RETRO_JS ||
                                   path.join(RAIZ, 'js/match/events/retroactive-modal.js'), 'utf8');
const SRC_PANEL  = fs.readFileSync(path.join(RAIZ, 'js/coach/comms/panel.js'), 'utf8');
const SRC_ENGINE = fs.readFileSync(path.join(RAIZ, 'js/coach/reports/report-engine.js'), 'utf8');

let fallos = 0, total = 0;
function ok(nombre, cond, detalle) {
    total++;
    if (cond) { console.log(`  ✓ ${nombre}`); }
    else { console.log(`  ✗ ${nombre}${detalle !== undefined ? '  → ' + detalle : ''}`); fallos++; }
}

// ── Plantilla tal y como la guarda live_matches (leída por REST) ───────────
function plantilla() {
    return [
        { id: 1,  number: '1',  name: 'PEDRO', team: 'home', status: 'field',  goals: 1, cards: 'ninguna', injured: false, time: 638 },
        { id: 7,  number: '7',  name: 'FEFO',  team: 'home', status: 'bench',  goals: 0, cards: 'ninguna', injured: false, time: 300 },
        { id: 10, number: '10', name: 'BRUNO', team: 'home', status: 'field',  goals: 0, cards: 'ninguna', injured: false, time: 420 },
        { id: 4,  number: '4',  name: 'TONI',  team: 'home', status: 'bench',  goals: 0, cards: 'ninguna', injured: false, time: 0 },
    ];
}
function partidoTerminado() {
    return {
        id: 'doramas-7-14082026-d4k8-1337', status: 'finished',
        homeTeam: { name: 'DORAMAS 7', score: 1 },
        awayTeam: { name: 'VISITANTE', score: 1 },
        players: plantilla(),
        events: [],
    };
}

// ── Sandbox del modal ─────────────────────────────────────────────────────
function elemento(id) {
    return { id, innerHTML: '', textContent: '', value: '', style: {}, attrs: {},
             appendChild() {}, remove() {}, setAttribute(k, v) { this.attrs[k] = v; },
             getAttribute(k) { return this.attrs[k] !== undefined ? this.attrs[k] : ''; },
             addEventListener() {} };
}

function entorno({ jugadoresEnMemoria = [], enCurso = 'otro-partido-en-curso' } = {}) {
    const reg = {};
    ['cronos-retroactive-modal', 'retro-half-select', 'retro-minute-input',
     'retro-player-select', 'retro-sub-player-select', 'retro-sub-container',
     'retro-player-label', 'btn-retro-goal', 'btn-retro-sub', 'btn-retro-yellow',
     'btn-retro-red', 'btn-retro-injury'].forEach(id => { reg[id] = elemento(id); });

    const eventos = [];
    const sb = {
        console: { log() {}, warn() {}, error() {} },
        document: {
            getElementById: (id) => reg[id] || null,
            createElement: () => elemento(''),
            body: { appendChild() {} },
        },
        setTimeout: (fn) => { try { fn(); } catch (e) {} },
        escapeHtml: (s) => String(s == null ? '' : s),
        showToast: () => {},
        alert: () => {},
        players: jugadoresEnMemoria,
        liveMatchId: enCurso,
        // Puerta de v434: aquí siempre deja pasar; su lógica ya tiene su guard.
        CronosMatchLock: { canAddEvent: () => true, lockReason: () => '' },
        _registerMatchEvent: (type, text, icon, matchTime, extra, target) => {
            eventos.push({ type, text, icon, matchTime, extra, target });
        },
        _datosEquipoDe: (p) => ({ team: p.team, teamName: 'DORAMAS 7' }),
        renderPlayers: () => {},
        updateMasterUI: () => {},
        syncScoreFromPlayers: () => {},
        _cronosMatchEvents: [],
        _eventos: eventos, _reg: reg,
    };
    sb.window = sb;
    vm.createContext(sb);
    vm.runInContext(SRC_MODAL, sb);
    return sb;
}

// Extrae el <select> pedido del HTML pintado en el modal.
function selectDe(html, id) {
    const i = html.indexOf(`id="${id}"`);
    if (i === -1) return '';
    const fin = html.indexOf('</select>', i);
    return fin === -1 ? '' : html.slice(i, fin);
}

// ───────────────────────────────────────────────────────────────────────────
console.log('\n── PARTE 1 · partido TERMINADO: se puede elegir jugador ──');
// ───────────────────────────────────────────────────────────────────────────
{
    // El escenario exacto del reporte: partido terminado, y en memoria NO están
    // sus jugadores (el entrenador no lo está jugando).
    const sb = entorno({ jugadoresEnMemoria: [] });
    sb.window.openRetroactiveEventModal('doramas-7-14082026-d4k8-1337', partidoTerminado());
    const html = sb._reg['cronos-retroactive-modal'].innerHTML;

    ok('1a · el modal se pinta', !!html && html.length > 200);
    ok('1b · 🔑🔑🔑 salen los jugadores del PARTIDO DESTINO (antes: sólo "Gol del Rival")',
       /PEDRO/.test(html) && /BRUNO/.test(html) && /FEFO/.test(html),
       html.includes('Gol del Rival') && !/PEDRO/.test(html)
           ? 'sólo aparece la opción de gol del rival' : 'no encuentro los nombres');

    // Y con tarjetas/lesiones, que es lo que él no podía registrar.
    sb.window._setRetroEventType('yellow');
    sb._reg['retro-player-select'].value = '10';
    sb._reg['retro-half-select'].value = '2T';
    sb._reg['retro-minute-input'].value = '38';
    sb.window.submitRetroactiveEvent();
    const ev = sb._eventos[0];
    ok('1c · 🔑 se registra una AMARILLA con su jugador en un partido terminado',
       !!ev && ev.type === 'yellow' && /BRUNO/.test(ev.text), ev ? ev.text : '(sin evento)');
    ok('1d · con el minuto exacto del formulario',
       !!ev && ev.matchTime === '2T 38:00', ev ? ev.matchTime : '—');
    ok('1e · y contra el partido destino, no contra el que hubiera en curso',
       !!ev && ev.target && ev.target.matchId === 'doramas-7-14082026-d4k8-1337',
       ev && ev.target ? String(ev.target.matchId) : '—');
}

// ───────────────────────────────────────────────────────────────────────────
console.log('\n── PARTE 2 · el selector, legible también en el móvil ──');
// ───────────────────────────────────────────────────────────────────────────
{
    const sb = entorno({ jugadoresEnMemoria: [] });
    sb.window.openRetroactiveEventModal('doramas-7-14082026-d4k8-1337', partidoTerminado());
    const html = sb._reg['cronos-retroactive-modal'].innerHTML;
    const principal = selectDe(html, 'retro-player-select');

    ok('2a · 🔑🔑 campo y banquillo van AGRUPADOS (la rueda del móvil recorta el sufijo)',
       /<optgroup[^>]*label="[^"]*[Cc]ampo/.test(principal) &&
       /<optgroup[^>]*label="[^"]*[Bb]anquillo/.test(principal),
       'siguen mezclados en una lista plana');
    ok('2b · el grupo de CAMPO va primero',
       principal.indexOf('ampo') < principal.indexOf('anquillo'));
    ok('2c · dentro de cada grupo, ordenados por dorsal',
       principal.indexOf('#1 ') < principal.indexOf('#10 ') &&
       principal.indexOf('#4 ') < principal.indexOf('#7 '),
       'orden por dorsal incorrecto');
    ok('2d · 🔑 y ya no hace falta leer "(Campo)" al final del texto',
       !/\(Campo\)/.test(principal) && !/\(Banquillo\)/.test(principal),
       'el sufijo sigue ahí, que es lo que el móvil recorta');
    ok('2e · se puede registrar un gol del RIVAL aunque haya plantilla',
       /value="rival"/.test(principal), 'no existe la opción de gol del rival');
}
{
    // El CAMBIO: sale uno del campo, entra uno del banquillo.
    const sb = entorno({ jugadoresEnMemoria: [] });
    sb.window.openRetroactiveEventModal('doramas-7-14082026-d4k8-1337', partidoTerminado());
    sb.window._setRetroEventType('sub');
    // ⚠️ Tras cambiar de tipo, las opciones se repintan DENTRO de cada <select>:
    // seguir mirando el HTML inicial del modal medía el estado anterior.
    const sale  = String(sb._reg['retro-player-select'].innerHTML);
    const entra = String(sb._reg['retro-sub-player-select'].innerHTML);

    ok('2f · 🔑 el que SALE se elige entre los del campo',
       /BRUNO/.test(sale) && !/FEFO/.test(sale),
       'la lista del que sale incluye a gente del banquillo');
    ok('2g · 🔑 y el que ENTRA entre los del banquillo',
       /FEFO/.test(entra) && !/BRUNO/.test(entra),
       'la lista del que entra incluye a gente del campo');
    ok('2h · ⚠️ la etiqueta ya no dice que el que sale está en el banquillo',
       !/Sale \(Banquillo\)/.test(String(sb._reg['retro-player-label'].textContent)) &&
       /[Cc]ampo/.test(String(sb._reg['retro-player-label'].textContent)),
       String(sb._reg['retro-player-label'].textContent));
}

// ───────────────────────────────────────────────────────────────────────────
console.log('\n── PARTE 3 · corrige estadísticas y marcador (partido terminado) ──');
// ───────────────────────────────────────────────────────────────────────────
{
    const sb = entorno({ jugadoresEnMemoria: [] });
    const partido = partidoTerminado();
    sb.window.openRetroactiveEventModal(partido.id, partido);
    sb._reg['retro-player-select'].value = '10';       // BRUNO
    sb._reg['retro-half-select'].value = '1T';
    sb._reg['retro-minute-input'].value = '12';
    sb.window._setRetroEventType('goal');
    sb.window.submitRetroactiveEvent();

    const bruno = partido.players.find(p => String(p.id) === '10');
    ok('3a · 🔑 el gol suma en el jugador del partido destino',
       bruno && bruno.goals === 1, bruno ? String(bruno.goals) : '—');
    ok('3b · 🔑 y el marcador del partido guardado se corrige (1 → 2)',
       partido.homeTeam.score === 2, String(partido.homeTeam.score));
    ok('3c · el rival no se toca', partido.awayTeam.score === 1, String(partido.awayTeam.score));

    // Un gol del rival sube el marcador visitante y ningún jugador propio.
    const sb2 = entorno({ jugadoresEnMemoria: [] });
    const p2 = partidoTerminado();
    sb2.window.openRetroactiveEventModal(p2.id, p2);
    sb2._reg['retro-player-select'].value = 'rival';
    sb2.window._setRetroEventType('goal');
    sb2.window.submitRetroactiveEvent();
    ok('3d · un gol del rival sube el marcador visitante',
       p2.awayTeam.score === 2, String(p2.awayTeam.score));
    ok('3d2 · …y no le suma un gol a nadie de casa',
       p2.players.every(p => p.goals === (String(p.id) === '1' ? 1 : 0)));

    // Tarjetas y lesión
    const sb3 = entorno({ jugadoresEnMemoria: [] });
    const p3 = partidoTerminado();
    sb3.window.openRetroactiveEventModal(p3.id, p3);
    sb3._reg['retro-player-select'].value = '7';
    sb3.window._setRetroEventType('red');
    sb3.window.submitRetroactiveEvent();
    const fefo = p3.players.find(p => String(p.id) === '7');
    ok('3e · una roja queda anotada en el jugador del partido destino',
       fefo && fefo.cards === 'roja', fefo ? String(fefo.cards) : '—');
}

// ───────────────────────────────────────────────────────────────────────────
console.log('\n── PARTE 4 · llega al informe, y marcado como retroactivo ──');
// ───────────────────────────────────────────────────────────────────────────
{
    const sb = entorno({ jugadoresEnMemoria: [] });
    const partido = partidoTerminado();
    sb.window.openRetroactiveEventModal(partido.id, partido);
    sb._reg['retro-player-select'].value = '10';
    sb._reg['retro-half-select'].value = '2T';
    sb._reg['retro-minute-input'].value = '55';
    sb.window._setRetroEventType('goal');
    sb.window.submitRetroactiveEvent();

    const bruno = partido.players.find(p => String(p.id) === '10');
    ok('4a · 🔑🔑 el evento entra en el HISTORIAL del jugador (antes no lo tocaba nadie)',
       !!bruno && Array.isArray(bruno.history) && bruno.history.length === 1,
       bruno ? JSON.stringify(bruno.history) : '—');
    ok('4b · con el minuto del formulario, que es el que pidió',
       !!bruno && /55:00/.test(String(bruno.history && bruno.history[0])),
       bruno ? String(bruno.history && bruno.history[0]) : '—');
    ok('4c · 🔑 y con marca de retroactivo, para poder pintarlo distinto',
       !!bruno && /RETRO/i.test(String(bruno.history && bruno.history[0])),
       bruno ? String(bruno.history && bruno.history[0]) : '—');
}
{
    // El parser de informes tiene que CONSERVAR esa marca, y sobrevivir a un
    // re-parseo (la lección de v426 con `phase` y de v445 con `realTime`).
    const sb = { console: { log() {}, warn() {}, error() {} }, window: {}, document: { getElementById: () => null } };
    sb.window = sb;
    vm.createContext(sb);
    try { vm.runInContext(SRC_PANEL, sb); } catch (e) { /* el fichero tiene más cosas */ }
    const parse = sb._parseHistoryForFirestore || sb.window._parseHistoryForFirestore;
    ok('4d · el parser de historial es accesible', typeof parse === 'function');
    if (typeof parse === 'function') {
        const uno = parse(['GOL a las 55:00 (2ªP) (RETRO) @14:33:50']);
        ok('4e · 🔑 marca `retro` a partir de la cadena',
           uno.length === 1 && uno[0].retro === true, JSON.stringify(uno[0]));
        ok('4e2 · y no lo confunde con un apunte de fase',
           uno[0].phase === false && uno[0].type === 'goal', JSON.stringify(uno[0]));
        ok('4e3 · conserva el minuto exacto', uno[0].timeStr === '55:00', String(uno[0].timeStr));
        const dos = parse(uno);   // re-parseo, como hace un informe ya guardado
        ok('4f · ⚠️ la marca SOBREVIVE a un re-parseo (lección de v426)',
           dos.length === 1 && dos[0].retro === true, JSON.stringify(dos[0]));
        const normal = parse(['GOL a las 12:00 (1ªP)']);
        ok('4g · un evento normal NO se marca como retroactivo',
           normal[0].retro !== true, JSON.stringify(normal[0]));
    }
}
{
    ok('4h · 🔑 el informe pinta en NARANJA lo retroactivo',
       /retro/.test(SRC_ENGINE) && /#f5a623|#ff9800|naranja|#e8912d/i.test(SRC_ENGINE),
       'report-engine no distingue los eventos retroactivos');
    ok('4i · y lo explica, para que el director sepa qué significa el color',
       /[Rr]etroactiv/.test(SRC_ENGINE), 'no hay leyenda que explique el naranja');
}

// ───────────────────────────────────────────────────────────────────────────
console.log('\n── PARTE 5 · lo que NO puede romperse ──');
// ───────────────────────────────────────────────────────────────────────────
{
    // Partido EN CURSO: la lista sale de los jugadores en memoria, como siempre.
    const sb = entorno({ jugadoresEnMemoria: plantilla(), enCurso: 'partido-vivo' });
    sb.window.openRetroactiveEventModal('partido-vivo', null);
    const html = sb._reg['cronos-retroactive-modal'].innerHTML;
    ok('5a · en el partido EN CURSO se siguen usando los jugadores en memoria',
       /PEDRO/.test(html) && /BRUNO/.test(html));
    sb._reg['retro-player-select'].value = '1';
    sb.window._setRetroEventType('injury');
    sb.window.submitRetroactiveEvent();
    ok('5b · y se registra igual que antes',
       sb._eventos.length === 1 && sb._eventos[0].type === 'injury',
       JSON.stringify(sb._eventos.map(e => e.type)));
    ok('5c · ⚠️ la ventana de bloqueo sigue mandando (v434)',
       /CronosMatchLock/.test(SRC_MODAL) && /canAddEvent/.test(SRC_MODAL));
}
{
    // ⚠️ LA BARRERA DE SERVIDOR SIGUE EN PIE. `lmOnlyEvents()` de
    // firestore.rules permite cambiar SOLO `events` y `updatedAt` en la ventana
    // de gracia: escribir el marcador de un partido terminado se DENIEGA, y se
    // puso así en v434 para impedir falsificarlo. Estas aserciones fijan que
    // seguimos sabiéndolo y que no se le miente al usuario.
    const RULES = fs.readFileSync(path.join(RAIZ, 'firestore.rules'), 'utf8');
    // ⚠️ ESTA ASERCIÓN YA SE DISPARÓ UNA VEZ, Y ACERTÓ: fijaba la lista vieja
    // (`events` + `updatedAt`) y se puso roja en cuanto el autor aprobó la
    // relajación de v531, obligando a revisar el aviso al usuario. Ahora fija lo
    // que de verdad hay que proteger: que la ventana siga siendo una lista
    // CERRADA y que no se cuele en ella nada que permita reescribir el partido.
    // ⚠️ ACOTAR EL REGEX A LA FUNCIÓN. Buscar `hasOnly` en todo el fichero cogía
    // el primero, que es de la colección `users`, y las dos aserciones salían
    // rojas midiendo otra cosa. Ya pasó al parchear reglas con un `[\s\S]*?` sin
    // techo: 23 sustituciones en vez de 3.
    const iFn = RULES.indexOf('function lmOnlyEvents()');
    const bloqueFn = iFn === -1 ? '' : RULES.slice(iFn, iFn + 400);
    const listaGracia = (bloqueFn.match(/affectedKeys\(\)\.hasOnly\(\[([\s\S]*?)\]\)/) || [])[1] || '';
    ok('5d · ⚠️ la ventana de gracia sigue siendo una lista CERRADA',
       /'events'/.test(listaGracia) && /'updatedAt'/.test(listaGracia) &&
       /'players'/.test(listaGracia) && /'homeTeam'/.test(listaGracia) && /'awayTeam'/.test(listaGracia),
       listaGracia.replace(/\s+/g, ' ').trim() || '(no encuentro el hasOnly)');
    ok('5d2 · 🔑 y NO deja tocar cronómetros, formación ni estado (eso sería barra libre)',
       !/'timeH1'|'timeH2'|'formation'|'status'|'finishedAt'/.test(listaGracia),
       listaGracia.replace(/\s+/g, ' ').trim());
    ok('5e · 🔑 y si el servidor rechaza la corrección, se DICE en vez de dar por bueno',
       /no se han podido corregir las estad/i.test(SRC_MODAL),
       'el modal cantaría éxito sobre algo que no se ha guardado');
    ok('5f · la corrección se intenta contra el partido destino',
       /_persisteCorreccionDestino/.test(SRC_MODAL) && /live_matches/.test(SRC_MODAL));
}

// ───────────────────────────────────────────────────────────────────────────
console.log('\n' + '─'.repeat(70));
console.log(`Resultado: ${total - fallos}/${total}`);
if (fallos) {
    console.log(`❌ ${fallos} aserción(es) en rojo`);
    process.exit(1);
}
console.log('✅ Los eventos perdidos funcionan igual en PC, iPad y móvil');

// ─────────────────────────────────────────────────────────────────────────
// test_gol_marcador_avisa.js  ·  el botón + del marcador superior emite
// suceso y aviso, tambien para el visitante sin plantilla (v471)
//
// Reporte del autor (captura 8504): al sumar un gol al VISITANTE desde el
// marcador superior —sin plantilla ni dorsal— el marcador subia pero NO salia
// ningun aviso flotante ni alarma en el panel en vivo.
//
// ⚠️ ERA MAS ANCHO DE LO QUE PARECIA. Ninguno de los TRES caminos de
// `changeScore` emitia suceso, ni siquiera eligiendo goleador de la lista. El
// unico gol que avisaba era el de la FICHA del jugador (player-actions.js), que
// si llama a `_registerMatchEvent`. Desde el marcador se llamaba a `logEvent()`,
// que SOLO escribe en el historial del jugador y no emite nada — por eso el
// panel en vivo no se enteraba nunca.
//
// LO QUE PROTEGE:
//
//  A · LOS TRES CAMINOS AVISAN: goleador elegido, "0 · Gol No Asignado" y
//      equipo SIN plantilla (el visitante del reporte).
//
//  B · EL AVISO DICE DE QUE EQUIPO ES. Sin jugador al que atribuirlo, el
//      suceso viaja con `{team, teamName}` en su campo estructurado, que es de
//      donde el visor saca el chip; y el texto dice el nombre del club (o
//      LOCAL/VISITANTE si no hay ninguno configurado). Un aviso que solo diga
//      "GOL" no sirve con varios partidos en pantalla.
//
//  C · 🔑 EL FORMATO `GOL · <quien>` ES EL CONTRATO. El visor recorta por
//      ' · ' para sacar el autor (los goles no llevan campo estructurado con
//      el nombre, ver project_feed_tarjetas_en_vivo). Cambiarlo por "GOL -"
//      o "GOL:" rompe el feed de las tarjetas sin dar ningun error.
//
//  D · ⚠️ CANCELAR EL PROMPT NO ES UN GOL. Si el entrenador cierra el dialogo
//      no se emite nada ni se fuerza envio: sin esto se anunciaria un gol que
//      acaba de descartar, y un aviso no se puede retirar.
//
//  E · UN GOL SE ENVIA AL INSTANTE (`liveSyncFlushNow`), no por el throttle de
//      500 ms. Es la misma decision que la ficha del jugador tiene desde v225.
//
// ESTE GUARD EJECUTA `changeScore` de verdad, con `players`, `TEAM_NAMES` y un
// `prompt` simulados. Un regex veria que existe la llamada, no CUAL de los tres
// caminos la alcanza.
// ─────────────────────────────────────────────────────────────────────────
const fs   = require('fs');
const path = require('path');
const vm   = require('vm');

const ROOT = path.join(__dirname, '..');
let fail = 0, pass = 0;
const ok = (name, cond, extra) => {
    if (cond) { pass++; console.log('PASS ' + name); }
    else { fail++; console.log('FAIL ' + name); if (extra !== undefined) console.log('       ' + extra); }
};

const MOV = fs.readFileSync(path.join(ROOT, 'js', 'match', 'events', 'movement-log.js'), 'utf8');

console.log('── el + del marcador avisa (v471) ──\n');

// Se extraen SOLO las dos funciones que importan, para no arrastrar el resto
// del fichero (exportData y compañia) a la caja de arena.
const ini = MOV.indexOf('function _avisaGolDesdeMarcador');
const fin = MOV.indexOf('async function exportData');
ok('0 · se pueden extraer changeScore y su ayudante', ini !== -1 && fin > ini);
if (ini === -1 || fin <= ini) process.exit(1);

// ── Caja de arena: lo justo para que changeScore corra ──
function montar(opts) {
    const marcador = { home: 0, away: 0 };
    const eventos = [];
    const avisos  = [];
    let flushes = 0, throttles = 0;

    const sb = {
        console: { log() {}, warn() {} },
        isRunning: true,
        matchPhase: '1st_half',
        masterTimeH1: 600, masterTimeH2: 0,
        players: opts.players || [],
        TEAM_NAMES: opts.teamNames || { home: 'CD LOCAL', away: 'CD RIVAL' },
        alert: () => {},
        prompt: () => opts.respuesta,
        document: { getElementById: (id) => {
            const t = id === 'score-home' ? 'home' : id === 'score-away' ? 'away' : null;
            if (!t) return null;
            return { get textContent() { return String(marcador[t]); },
                     set textContent(v) { marcador[t] = parseInt(v) || 0; } };
        } },
        formatTime: (s) => String(s),
        _horaRealAhora: () => '20:00',
        logEvent: (p, txt) => { if (p && p.history) p.history.push(txt); },
        renderPlayers: () => {},
        showToast: (t) => avisos.push(t),
        // El emisor real de sucesos: se captura lo que se le manda.
        _registerMatchEvent: (type, text, icon, mt, extra) => eventos.push({ type, text, icon, extra }),
        syncScoreFromPlayers: (t) => {
            const total = (opts.players || []).filter(x => x.team === t)
                .reduce((s, x) => s + (x.goals || 0), 0);
            const extra = sb.window._cronosExtraGoals ? (sb.window._cronosExtraGoals[t] || 0) : 0;
            marcador[t] = total + extra;
        },
        liveSyncOnAction: () => { throttles++; },
    };
    sb.window = { _cronosExtraGoals: { home: 0, away: 0 },
                  liveSyncFlushNow: () => { flushes++; } };
    vm.createContext(sb);
    vm.runInContext(MOV.slice(ini, fin), sb);
    return { sb, marcador, eventos, avisos,
             flushes: () => flushes, throttles: () => throttles };
}
const jugador = (n, team) => ({ id: n, number: n, name: 'Jugador ' + n, team,
                                status: 'field', goals: 0, history: [] });

// ═══════════ PARTE 1 · el caso del reporte: visitante SIN plantilla ═══════════
console.log('── PARTE 1 · el caso del reporte: visitante sin plantilla ──');
{
    // Sólo hay jugadores locales: el visitante no tiene convocatoria cargada.
    const e = montar({ players: [jugador(1, 'home')] });
    e.sb.changeScore('away', 1);

    ok('1a · el marcador del visitante sube', e.marcador.away === 1, String(e.marcador.away));
    ok('1b · 🔑 SE EMITE el suceso de gol (era lo que faltaba)',
       e.eventos.length === 1 && e.eventos[0].type === 'goal',
       JSON.stringify(e.eventos));
    ok('1c · con el icono de gol', e.eventos[0] && e.eventos[0].icon === '⚽');
    // B · el aviso tiene que decir de quién es.
    ok('1d · 🔑 el suceso dice que es del VISITANTE (campo estructurado)',
       e.eventos[0] && e.eventos[0].extra && e.eventos[0].extra.team === 'away',
       JSON.stringify(e.eventos[0] && e.eventos[0].extra));
    ok('1e · y lleva el nombre del club rival',
       e.eventos[0] && e.eventos[0].extra.teamName === 'CD RIVAL',
       JSON.stringify(e.eventos[0] && e.eventos[0].extra));
    ok('1f · el texto nombra al equipo, no queda en un "GOL" pelado',
       e.eventos[0] && e.eventos[0].text.indexOf('CD RIVAL') !== -1, e.eventos[0] && e.eventos[0].text);
    // C · el formato es el contrato del visor.
    ok('1g · 🔑 respeta el formato `GOL · <quién>` (el visor recorta por " · ")',
       e.eventos[0] && /^GOL · /.test(e.eventos[0].text), e.eventos[0] && e.eventos[0].text);
    // E · instantáneo.
    ok('1h · se envía AL INSTANTE, no por el throttle',
       e.flushes() === 1 && e.throttles() === 0,
       'flush=' + e.flushes() + ' throttle=' + e.throttles());
}

// ═══════════ PARTE 2 · sin nombre de club configurado ═══════════
console.log('\n── PARTE 2 · sin nombre de club, se dice VISITANTE ──');
{
    const e = montar({ players: [jugador(1, 'home')], teamNames: { home: '', away: '' } });
    e.sb.changeScore('away', 1);
    ok('2a · el aviso dice VISITANTE cuando no hay club configurado',
       e.eventos[0] && e.eventos[0].text.indexOf('VISITANTE') !== -1, e.eventos[0] && e.eventos[0].text);
    const e2 = montar({ players: [jugador(1, 'away')], teamNames: { home: '', away: '' } });
    e2.sb.changeScore('home', 1);
    ok('2b · y LOCAL en el caso simétrico',
       e2.eventos[0] && e2.eventos[0].text.indexOf('LOCAL') !== -1, e2.eventos[0] && e2.eventos[0].text);
}

// ═══════════ PARTE 3 · los otros dos caminos ═══════════
console.log('\n── PARTE 3 · goleador elegido y gol no asignado ──');
{
    // A · goleador elegido de la lista.
    const e = montar({ players: [jugador(7, 'home'), jugador(9, 'home')], respuesta: '2' });
    e.sb.changeScore('home', 1);
    ok('3a · con goleador elegido TAMBIÉN se emite (antes tampoco avisaba)',
       e.eventos.length === 1 && e.eventos[0].type === 'goal', JSON.stringify(e.eventos));
    ok('3b · y el aviso lleva el nombre del goleador',
       e.eventos[0] && e.eventos[0].text === 'GOL · Jugador 9', e.eventos[0] && e.eventos[0].text);
    ok('3c · con su equipo', e.eventos[0] && e.eventos[0].extra.team === 'home');
    ok('3d · e instantáneo', e.flushes() === 1);

    // A · "0 · Gol No Asignado" con plantilla presente.
    const e2 = montar({ players: [jugador(7, 'home')], respuesta: '0' });
    e2.sb.changeScore('home', 1);
    ok('3e · "Gol No Asignado" también emite', e2.eventos.length === 1, JSON.stringify(e2.eventos));
    ok('3f · atribuido al equipo, no a nadie',
       e2.eventos[0] && e2.eventos[0].text.indexOf('CD LOCAL') !== -1, e2.eventos[0] && e2.eventos[0].text);
}

// ═══════════ PARTE 4 · ⚠️ lo que NO debe avisar ═══════════
console.log('\n── PARTE 4 · ⚠️ lo que NO puede avisar ──');
{
    // D · cancelar el prompt no es un gol.
    const e = montar({ players: [jugador(7, 'home')], respuesta: null });
    e.sb.changeScore('home', 1);
    ok('4a · ⚠️🔑 cancelar el diálogo NO emite gol', e.eventos.length === 0, JSON.stringify(e.eventos));
    ok('4b · ni fuerza el envío inmediato', e.flushes() === 0,
       'anunciar un gol descartado no tiene vuelta atrás');

    // Una respuesta vacía tampoco.
    const e2 = montar({ players: [jugador(7, 'home')], respuesta: '   ' });
    e2.sb.changeScore('home', 1);
    ok('4c · una respuesta en blanco tampoco', e2.eventos.length === 0);

    // Quitar un gol no es un gol.
    const e3 = montar({ players: [jugador(7, 'home')] });
    e3.sb.window._cronosExtraGoals.home = 1;
    e3.sb.changeScore('home', -1);
    ok('4d · quitar un gol no emite suceso de gol', e3.eventos.length === 0, JSON.stringify(e3.eventos));
    ok('4e · y ése sí puede ir por el throttle (no corre prisa)',
       e3.flushes() === 0 && e3.throttles() === 1,
       'flush=' + e3.flushes() + ' throttle=' + e3.throttles());

    // Con el cronómetro parado no se suma nada.
    const e4 = montar({ players: [jugador(7, 'home')] });
    e4.sb.isRunning = false;
    e4.sb.changeScore('away', 1);
    ok('4f · con el cronómetro parado no se emite nada',
       e4.eventos.length === 0 && e4.marcador.away === 0);
}

// ═══════════ PARTE 5 · robustez ═══════════
console.log('\n── PARTE 5 · robustez ──');
{
    // El aviso jamás puede impedir que el gol se sume.
    const e = montar({ players: [] });
    e.sb._registerMatchEvent = () => { throw new Error('emisor roto'); };
    let reventó = false;
    try { e.sb.changeScore('away', 1); } catch (err) { reventó = true; }
    ok('5a · ⚠️ si el emisor de sucesos falla, el GOL SE SUMA igual',
       !reventó && e.marcador.away === 1,
       'el marcador es lo que el entrenador está mirando: no puede depender del aviso');
}

console.log('\n────────────────────────────────');
console.log('PASS: ' + pass + '   FAIL: ' + fail);
process.exit(fail === 0 ? 0 : 1);

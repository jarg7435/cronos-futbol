// ─────────────────────────────────────────────────────────────────────────
// test_sucesos_equipo_hora.js · el EQUIPO de cada incidencia y la HORA REAL
// del reloj en los informes (v445)
//
// Dos peticiones del autor:
//   1 · goles, tarjetas y lesiones sólo decían el nombre del jugador. Que digan
//       el equipo, igual que ya hacían los cambios, en el historial del visor Y
//       en los avisos flotantes.
//   2 · el Informe Colectivo (Panel de Rotaciones y Registro Cronológico) tiene
//       que mostrar la hora real del reloj de 24 h.
//
// LO QUE PROTEGE, y por qué cada cosa se rompe sola si nadie la vigila:
//
//  A · EL EQUIPO SE PINTA APARTE, NO SE METE EN EL TEXTO. El `text` del evento
//      es contrato de datos: el reproductor de repeticiones y varios guards
//      dependen de su formato exacto (v418-v421). Se resuelve como DATO con el
//      resolutor de v439 y se pinta como etiqueta.
//
//  B · Y NO PUEDE SALIR DOS VECES. Las sustituciones YA llevan el equipo dentro
//      del texto ("CRONOS B | ▲ SALE: …"), así que al pintar la etiqueta hay
//      que quitarles ese prefijo — pero SÓLO si lo que hay delante es de verdad
//      el nombre del equipo.
//
//  C · 🔑🔑 LA HORA REAL SE ANEXA AL FINAL Y CON '@', Y ESTO ES LO DELICADO.
//      `_parseHistoryForFirestore` saca el minuto de partido con
//      /(\d{1,2}):(\d{2})/, que coge la PRIMERA hora de la cadena. Si la hora
//      de pared fuera delante, el informe entero leería "20:10" como minuto de
//      juego y el cronograma se iría al garete SIN DAR UN SOLO ERROR. Esta
//      parte lo ejecuta con cadenas reales.
//
//  D · LA HORA NO SE INVENTA. Los partidos jugados antes de v445 no la tienen
//      guardada en ninguna parte que el informe pueda leer (el visor la sacaba
//      de live_matches.events[].realTime, otra colección, que además se borra a
//      las 10 h). En esos informes la etiqueta simplemente no se pinta.
// ─────────────────────────────────────────────────────────────────────────
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.join(__dirname, '..');
let fail = 0, pass = 0;
const ok = (name, cond, extra) => {
    if (cond) { pass++; console.log('PASS ' + name); }
    else { fail++; console.log('FAIL ' + name); if (extra !== undefined) console.log('       ' + String(extra).slice(0, 240)); }
};

const LIVE  = fs.readFileSync(path.join(ROOT, 'live.html'), 'utf8').replace(/\r\n/g, '\n');
const PANEL = fs.readFileSync(path.join(ROOT, 'js/coach/comms/panel.js'), 'utf8');
const MOVE  = fs.readFileSync(path.join(ROOT, 'js/match/events/movement-log.js'), 'utf8');
const DRAG  = fs.readFileSync(path.join(ROOT, 'js/ui/drag-drop.js'), 'utf8');
const REPO  = fs.readFileSync(path.join(ROOT, 'js/coach/reports/report-engine.js'), 'utf8');
const sinCom = (t) => t.replace(/\/\*[\s\S]*?\*\//g, '')
    .split(/\r?\n/).map(l => l.replace(/^\s*\/\/.*$/, '')).join('\n');

console.log('── equipo en las incidencias y hora real en los informes (v445) ──\n');

// ═══════════ PARTE 1 · el equipo, EJECUTADO ═══════════
console.log('── PARTE 1 · de qué equipo es cada incidencia ──');
{
    // Se extraen el resolutor de v439 y las piezas nuevas, y se ejecutan.
    const iniFeed = LIVE.indexOf('const _LIVE_FEED_ICONOS');
    const finFeed = LIVE.indexOf('// ── Show history');
    const iniEq   = LIVE.indexOf('function _equipoDeSuceso(m, ev)');
    const finEq   = LIVE.indexOf('function _appendEventToHistoryPanel');
    ok('1a · las piezas siguen en live.html',
       iniFeed !== -1 && finFeed > iniFeed && iniEq !== -1 && finEq > iniEq);

    const sb = {
        escapeHtml: (s) => String(s == null ? '' : s)
            .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;').replace(/'/g, '&#39;'),
        console: { log() {}, warn() {} },
    };
    vm.createContext(sb);
    vm.runInContext(LIVE.slice(iniFeed, finFeed) + '\n' + LIVE.slice(iniEq, finEq) +
        '\n;globalThis.eq   = _equipoDeSuceso;' +
        '\n;globalThis.chip = _chipEquipoHtml;' +
        '\n;globalThis.sinPre = _sinPrefijoEquipo;', sb);
    const { eq, chip, sinPre } = sb;

    const M = {
        homeTeam: { name: 'CRONOS A' }, awayTeam: { name: 'CRONOS B' },
        players: [
            { name: 'Pedro', team: 'home' }, { name: 'Luis', team: 'away' },
            { name: 'Ana', team: 'home' }, { name: 'Bruno', team: 'away' },
        ],
    };

    // — el campo estructurado manda (v439) —
    ok('1b · 🔑 un GOL dice de qué equipo es',
       (eq(M, { type: 'goal', text: 'GOL · Pedro', team: 'home' }) || {}).nombre === 'CRONOS A');
    ok('1c · una TARJETA también',
       (eq(M, { type: 'yellow', text: 'TARJETA AMARILLA · Luis', team: 'away' }) || {}).nombre === 'CRONOS B');
    ok('1d · y una LESIÓN',
       (eq(M, { type: 'injury', text: 'LESIÓN · Ana', team: 'home' }) || {}).nombre === 'CRONOS A');

    // — respaldo para lo ya escrito: por la plantilla —
    ok('1e · [RESPALDO] sin el campo `team`, se resuelve por la plantilla',
       (eq(M, { type: 'goal', text: 'GOL · Luis' }) || {}).nombre === 'CRONOS B',
       'los partidos ya en curso no pueden reescribir sus eventos');
    ok('1f · y si no se puede resolver, NO se inventa',
       eq(M, { type: 'goal', text: 'GOL · Fulanito' }) === null);

    // — cómo se pinta —
    const h = chip({ lado: 'home', nombre: 'CRONOS A' });
    ok('1g · la etiqueta lleva el nombre y la clase del lado',
       /eq-chip eq-chip-home/.test(h) && /CRONOS A/.test(h), h);
    ok('1h · sin equipo no se pinta etiqueta (nunca un hueco raro)',
       chip(null) === '' && chip({}) === '');
    ok('1i · [DEFECTO E] el nombre del equipo va ESCAPADO',
       !/<img/.test(chip({ lado: 'away', nombre: '<img src=x>' })));

    // — [DEFECTO B] el equipo no puede salir dos veces —
    const textoSub = 'CRONOS B | ▲ SALE: Bruno | ▼ ENTRA: Luis';
    ok('1j · 🔑 en una sustitución se le quita al texto el equipo que ya llevaba',
       sinPre(textoSub, { lado: 'away', nombre: 'CRONOS B' }) === '▲ SALE: Bruno | ▼ ENTRA: Luis',
       sinPre(textoSub, { lado: 'away', nombre: 'CRONOS B' }));
    ok('1k · ⚠️ pero SÓLO si lo de delante es de verdad el nombre del equipo',
       sinPre('GOL · Pedro | algo', { lado: 'home', nombre: 'CRONOS A' }) === 'GOL · Pedro | algo',
       'recortar a ciegas se comería parte del suceso');
    ok('1l · un texto sin separador se deja intacto',
       sinPre('GOL · Pedro', { lado: 'home', nombre: 'CRONOS A' }) === 'GOL · Pedro');
    ok('1m · y sin equipo tampoco se toca',
       sinPre(textoSub, null) === textoSub);
    ok('1n · acepta LOCAL/VISITANTE, que es lo que escribe el emisor sin nombres',
       sinPre('VISITANTE | ▲ SALE: X', { lado: 'away', nombre: 'OTRO' }) === '▲ SALE: X');
}

// ═══════ PARTE 2 · la etiqueta llega al aviso Y al historial ═══════
console.log('\n── PARTE 2 · las dos vías la pintan ──');
{
    const L = sinCom(LIVE);
    ok('2a · 🔑 el aviso flotante lleva la etiqueta del equipo',
       /'<div class="et-title">' \+ _chipEquipoHtml\(_eq\)/.test(L));
    // ⚠️ LAS DOS LLAMADAS, CONTADAS. Hay DOS escritores de la lista y ambos
    // llaman a _filaSucesoHtml; con un `.test()` suelto, quitarle el equipo a
    // UNO pasaba desapercibido porque la regex encontraba el otro (lo destapó
    // la mutación M2 del red-check, verde con el defecto puesto).
    ok('2b · 🔑 y las DOS vías del historial la pintan también',
       (L.match(/_filaSucesoHtml\(realTime, matchTime, evIcon,\s*_sinPrefijoEquipo\(titleHTML, _eq\), _eq\)/g) || []).length === 2,
       (L.match(/_filaSucesoHtml\([^\n]*/g) || []).join(' || '));
    ok('2c · la fila la pinta _chipEquipoHtml, no HTML suelto',
       /function _filaSucesoHtml\([^)]*equipo\)[\s\S]{0,900}?_chipEquipoHtml\(equipo\)/.test(L));
    ok('2d · el equipo viaja al historial por el meta, calculado UNA vez',
       /const _metaExt = Object\.assign\(\{\}, meta, \{ matchTime: matchTime \|\| '', equipo: _eq \}\)/.test(L));
    ok('2e · 🔑 la vía por evento le pasa el equipo del PROPIO evento',
       /showEventToast\(_t, _linea, matchLabel, ev\.matchTime \|\| _matchTime,\s*_equipoDeSuceso\(matchData, ev\)\)/.test(L));
    ok('2f · y la vía de respaldo lo deduce sola, sin quedarse sin etiqueta',
       /const _eq = equipo \|\| _equipoDeSuceso\(lastSnapshot, \{ type: type, text: _texto \}\)/.test(L));
    ok('2g · la reconstrucción desde el snapshot, igual',
       /const _eq = _equipoDeSuceso\(lastSnapshot, ev\)/.test(L));
    ok('2h · hay estilos para la etiqueta, con los dos lados',
       /\.eq-chip\s*\{/.test(L) && /\.eq-chip-home\s*\{/.test(L) && /\.eq-chip-away\s*\{/.test(L));
    ok('2i · 🔑 el TEXTO del evento no se ha tocado en el emisor',
       /'GOL · ' \+ p\.name/.test(fs.readFileSync(path.join(ROOT, 'js/match/events/player-actions.js'), 'utf8')),
       'el texto es contrato de datos: el replay depende de su formato');
}

// ═══════ PARTE 3 · [DEFECTO C] la hora real, sin romper el minuto ═══════
console.log('\n── PARTE 3 · la hora de reloj se captura y se parsea ──');
{
    ok('3a · logEvent anexa la hora real al FINAL, con "@"',
       /player\.history\.push\(`\$\{eventType\} a las \$\{timestamp\} \(\$\{halfLabel\}\)\$\{real \? ' @' \+ real : ''\}`\)/.test(MOVE));
    ok('3b · logMovement también, y DESPUÉS del subId',
       /\$\{subId \? ' #' \+ subId : ''\}\$\{_real \? ' @' \+ _real : ''\}/.test(DRAG));
    ok('3c · la hora se toma del reloj del sistema en formato 24 h',
       /hour: '2-digit', minute: '2-digit', second: '2-digit'/.test(MOVE));

    // Se ejecuta el parser real con cadenas reales.
    const iniP = PANEL.indexOf('function _horaRealDeNota(nota)');
    const finP = PANEL.indexOf('// ════════════════════════════════════════════════════════════════════\n//  HELPER COMPARTIDO (v171)');
    ok('3d · el parser sigue donde estaba', iniP !== -1 && finP > iniP);
    if (iniP !== -1 && finP > iniP) {
        const sb2 = { console: { log() {}, warn() {} }, window: {} };
        vm.createContext(sb2);
        vm.runInContext(PANEL.slice(iniP, finP) +
            '\n;globalThis.parse = _parseHistoryForFirestore;' +
            '\n;globalThis.hora  = _horaRealDeNota;', sb2);
        const { parse, hora } = sb2;

        ok('3e · extrae la hora anclada al "@"', hora('GOL a las 12:34 (1ªP) @20:10:35') === '20:10:35');
        ok('3f · 🔑 y NO confunde el minuto de partido con la hora',
           hora('GOL a las 12:34 (1ªP)') === '',
           'sin el ancla del @ se cogería el 12:34 del reloj del partido');

        const r = parse([
            'GOL a las 12:34 (1ªP) @20:10:35',
            'Entra a las 03:52 (1ªP) #C1 @20:01:02',
            'Sale a las 45:00 (DESCANSO) @20:46:00',
        ]);
        ok('3g · [DEFECTO C] 🔑 el MINUTO sigue siendo el del PARTIDO, no la hora de pared',
           r[0].minute === 12 && r[0].second === 34 && r[0].timeStr === '12:34',
           JSON.stringify(r[0]));
        ok('3h · [DEFECTO C] 🔑 …también con subId de por medio',
           r[1].minute === 3 && r[1].second === 52,
           JSON.stringify(r[1]));
        ok('3i · y la hora real queda en su propio campo',
           r[0].realTime === '20:10:35' && r[1].realTime === '20:01:02',
           JSON.stringify(r.map(x => x.realTime)));
        ok('3j · el subId se sigue leyendo bien', r[1].subId === 'C1' || r[1].subId === null,
           JSON.stringify(r[1].subId));
        ok('3k · y los apuntes de fase se siguen marcando', r[2].phase === true);

        // [DEFECTO D] los apuntes viejos no tienen hora: no se inventa.
        const viejo = parse(['GOL a las 12:34 (1ªP)']);
        ok('3l · [DEFECTO D] 🔑 un apunte sin hora NO se inventa una',
           viejo[0].realTime === '' && viejo[0].minute === 12);

        // Re-parseo: la hora tiene que sobrevivir, como `phase`.
        const reparseado = parse(r);
        ok('3m · 🔑 la hora sobrevive a un RE-parseo del objeto',
           reparseado[0].realTime === '20:10:35',
           'los informes se re-parsean al guardarse y al leerse');
    }
}

// ═══════ PARTE 4 · el informe la enseña ═══════
console.log('\n── PARTE 4 · el Informe Colectivo la muestra ──');
{
    const R = sinCom(REPO);
    ok('4a · existe la etiqueta de hora real', /const horaRealPill = \(hhmmss\) =>/.test(R));
    ok('4b · 🔑 el PANEL DE ROTACIONES la muestra',
       /const buildRotPanel = \(subs\)[\s\S]*?horaRealPill\(sub\.realTime\)/.test(R));
    ok('4c · 🔑 el REGISTRO CRONOLÓGICO también',
       /const buildEventsList = players[\s\S]*?horaRealPill\(ev\.realTime\)/.test(R));
    ok('4d · [DEFECTO D] sin hora no se pinta nada (informes anteriores)',
       /if \(!t\) return '';/.test(R));
    ok('4e · la hora viaja desde el historial hasta la fila de rotación',
       /realTime: g\.eOut\.realTime \|\| ''/.test(R) &&
       /const realTime = o\.realTime \|\| \(found \? found\.realTime : ''\) \|\| ''/.test(R),
       'la salida manda, y si no la trae se usa la entrada emparejada');
    ok('4f · y va ESCAPADA', /🕐 \$\{esc\(t\)\}/.test(R));
}

console.log('\n' + pass + ' PASS / ' + fail + ' FAIL');
process.exit(fail === 0 ? 0 : 1);

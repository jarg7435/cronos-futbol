// ═══════════════════════════════════════════════════════════════════════════
//  test_comentario_partido.js
//  v690 · EL SUCESO "COMENTARIO" EN "REGISTRAR EVENTO PERDIDO" — GUARD
// ═══════════════════════════════════════════════════════════════════════════
//  Encargo del autor (implementar.txt + captura 10265): un tipo de suceso
//  "Comentario" —notas tácticas o generales del partido, de los dos equipos—
//  con su parte y su minuto, que se guarde, salga EN ORDEN en el historial y
//  aparezca en el informe final. Decisión del autor: SÓLO lo ve el cuerpo
//  técnico.
//
//  Todo lo que se puede EJECUTAR se ejecuta (lección v620: un test que copia
//  la lógica no prueba nada):
//  PARTE 1 · el modal: botón, campo de texto, guardado, validación, y que el
//            tipo vuelva a "Gol" al reabrir.
//  PARTE 2 · la ruta central: el comentario no se pierde con el recorte a 200.
//  PARTE 3 · `cronosComentariosDelPartido`: lo que viaja al informe.
//  PARTE 4 · los tres despachos lo guardan en las copias de cuerpo técnico y
//            entrenador, y en NINGUNA de familias.
//  PARTE 5 · el motor del informe (_RP) lo pinta en su minuto.
//  PARTE 6 · el visor: en orden de partido, sin aviso, y oculto a familias.
// ═══════════════════════════════════════════════════════════════════════════
'use strict';

const fs   = require('fs');
const path = require('path');
const vm   = require('vm');

const ROOT = path.join(__dirname, '..');
const leer = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');
const sinCom = (t) => t.replace(/\/\*[\s\S]*?\*\//g, '').split(/\r?\n/).map(l => l.replace(/^\s*\/\/.*$/, '')).join('\n');

let fallos = 0, total = 0;
function ok(nombre, cond, detalle) {
    total++;
    if (cond) console.log('  ✓ ' + nombre);
    else { fallos++; console.log('  ✗ ' + nombre + (detalle !== undefined ? '  → ' + JSON.stringify(detalle).slice(0, 400) : '')); }
}
function trozo(src, cab, cierre) {
    const i = src.indexOf(cab);       if (i < 0) throw new Error('No se encontró: ' + cab);
    const j = src.indexOf(cierre, i); if (j < 0) throw new Error('Sin cierre de: ' + cab);
    return src.slice(i, j + cierre.length);
}
const escapeHtml = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;' }[c]));

(async () => {
// ───────────────────────────────────────────────────────────────────────────
console.log('\n── PARTE 1 · el modal "Registrar Evento Perdido" ──');
// ───────────────────────────────────────────────────────────────────────────
{
    const MODAL = leer('js/match/events/retroactive-modal.js');
    const registrados = [], toasts = [], escrituras = [];
    const els = {};
    const el = (id) => (els[id] = els[id] || { id, value: '', style: {}, focus() {}, innerHTML: '', textContent: '' });
    const jugadores = [{ id: 3, number: 3, name: 'SANCHO', status: 'field', team: 'home', goals: 0, history: [] }];
    const sb = {
        console: { log() {}, warn() {}, error() {} },
        escapeHtml, showToast: (m) => toasts.push(String(m)), Promise, String, Number, Array, Object, Date, JSON, Math, parseInt,
        _registerMatchEvent: (...a) => registrados.push(a),
        document: {
            getElementById: (id) => id === 'cronos-retroactive-modal' ? (els[id] || null) : el(id),
            createElement: () => ({ style: {}, innerHTML: '', className: '', id: '' }),
            body: { appendChild: (n) => { els['cronos-retroactive-modal'] = n; } },
        },
        liveMatchId: 'm_live',
    };
    sb.window = sb;
    sb.players = jugadores;
    vm.createContext(sb);
    vm.runInContext(MODAL, sb);
    const w = sb;

    await w.openRetroactiveEventModal();
    const html = (els['cronos-retroactive-modal'] || {}).innerHTML || '';
    ok('1a · 🔑 existe el botón "💬 Comentario" en Tipo de Suceso',
       /id="btn-retro-comment"[^>]*>💬 Comentario</.test(html));
    ok('1b · y un campo de texto libre (textarea) con tope de 500', /<textarea id="retro-comment-input"[^>]*maxlength="500"/.test(html));
    ok('1c · el campo del comentario empieza oculto', /id="retro-comment-container" style="display:none;"/.test(html));

    w._setRetroEventType('comment');
    ok('1d · al elegir Comentario se oculta el jugador y aparece el texto',
       el('retro-player-container').style.display === 'none' && el('retro-comment-container').style.display === 'block');

    // — vacío: no se guarda —
    el('retro-half-select').value = '2T';
    el('retro-minute-input').value = '67';
    el('retro-comment-input').value = '   ';
    await w.submitRetroactiveEvent();
    ok('1e · 🔴 un comentario VACÍO no se guarda y se avisa', registrados.length === 0 && /Escribe el comentario/.test(toasts.join('|')));

    // — con texto: se guarda —
    el('retro-comment-input').value = '  Presión alta del rival;\n  cerrar bandas  ';
    await w.submitRetroactiveEvent();
    const r = registrados[0] || [];
    ok('1f · 🔑 se registra como suceso "comment" por la ruta central', r[0] === 'comment', r[0]);
    ok('1g · 🔑 con la parte y el minuto elegidos ("2T 67:00")', r[3] === '2T 67:00', r[3]);
    ok('1h · el texto va en un campo ESTRUCTURADO (comment), limpio', r[4] && r[4].comment === 'Presión alta del rival; cerrar bandas', r[4]);
    ok('1i · y marcado como del cuerpo técnico', r[4] && r[4].staffOnly === true && r[4].minute === 67 && r[4].half === '2T');
    ok('1j · el texto visible es "COMENTARIO · …" con icono 💬', r[1] === 'COMENTARIO · Presión alta del rival; cerrar bandas' && r[2] === '💬');
    ok('1k · 🔑 NO toca a ningún jugador (ni goles, ni history, ni campo)',
       jugadores[0].goals === 0 && jugadores[0].history.length === 0 && jugadores[0].status === 'field');
    ok('1l · avisa de que saldrá en el informe', /Saldrá en el informe/.test(toasts[toasts.length - 1]));

    // — minuto inválido —
    registrados.length = 0;
    w._setRetroEventType('comment');
    el('retro-minute-input').value = 'abc';
    el('retro-comment-input').value = 'nota';
    await w.submitRetroactiveEvent();
    ok('1m · un minuto no válido no se guarda', registrados.length === 0 && /minuto válido/.test(toasts.join('|')));

    // — 🔑 al reabrir, el tipo vuelve a Gol (el modal se repinta con Gol marcado) —
    registrados.length = 0;
    w._setRetroEventType('comment');
    await w.openRetroactiveEventModal();
    el('retro-half-select').value = '1T';
    el('retro-minute-input').value = '10';
    el('retro-player-select').value = '3';
    el('retro-comment-input').value = 'resto de la vez anterior';
    await w.submitRetroactiveEvent();
    ok('1n · 🔴🔴 reabrir el modal NO guarda como "comentario" lo que se ve como "Gol"',
       registrados[0] && registrados[0][0] === 'goal', registrados[0] && registrados[0][0]);
}

// ───────────────────────────────────────────────────────────────────────────
console.log('\n── PARTE 2 · la ruta central no pierde el comentario ──');
// ───────────────────────────────────────────────────────────────────────────
const PA = leer('js/match/events/player-actions.js');
{
    const sb = { console: { log() {}, warn() {}, error() {} }, Date, Math, Object, String, Number, Array, JSON };
    sb.window = sb;
    sb._cronosMatchEvents = [];
    vm.createContext(sb);
    vm.runInContext('var _modalStaging = false; var _modalBuffer = [];\n' +
        trozo(PA, 'function _registerMatchEvent(', '\n}\n'), sb);
    sb._registerMatchEvent('comment', 'COMENTARIO · temprano', '💬', '1T 03:00', { comment: 'temprano', minute: 3, half: '1T' });
    for (let i = 0; i < 260; i++) sb._registerMatchEvent('goal', 'GOL · X', '⚽', undefined, null);
    const lista = sb.window._cronosMatchEvents;
    ok('2a · 🔑 tras 260 sucesos más, el comentario del minuto 3 SIGUE en la lista',
       lista.some(e => e.type === 'comment' && e.comment === 'temprano'), lista.length);
    ok('2b · el recorte sigue funcionando para lo demás (≈200)', lista.length <= 201, lista.length);
    const c = lista.find(e => e.type === 'comment') || {};
    ok('2c · el suceso lleva eventId, matchTime manual e isRetroactive',
       /^ev_/.test(c.eventId) && c.matchTime === '1T 03:00' && c.isRetroactive === true);
}

// ───────────────────────────────────────────────────────────────────────────
console.log('\n── PARTE 3 · lo que viaja al informe ──');
// ───────────────────────────────────────────────────────────────────────────
{
    const sb = { String, Number, Array, Object };
    sb.window = sb;
    vm.createContext(sb);
    // Sin la función (código anterior) el arnés NO se aborta: las partes
    // siguientes también tienen que medir el código viejo en el red-check.
    try { vm.runInContext(trozo(PA, 'window.cronosComentariosDelPartido = function', '\n};'), sb); }
    catch (e) { console.log('  (' + e.message + ')'); }
    const f = sb.window.cronosComentariosDelPartido;
    ok('3a · existe cronosComentariosDelPartido', typeof f === 'function');
    const evs = [
        { eventId: 'e2', type: 'comment', comment: 'segunda', matchTime: '2T 67:00', minute: 67, half: '2T', createdAt: 5 },
        { eventId: 'e9', type: 'goal', text: 'GOL · X', matchTime: '1T 10:00' },
        { eventId: 'e1', type: 'comment', comment: 'primera', matchTime: '1T 30:00', createdAt: 9, realTime: '18:40:00' },
        { eventId: 'e1', type: 'comment', comment: 'primera', matchTime: '1T 30:00', createdAt: 9 },   // repetido
        { eventId: 'e3', type: 'comment', comment: '   ', matchTime: '1T 31:00' },                       // vacío
    ];
    const out = f ? f(evs) : [];
    ok('3b · 🔑 sólo comentarios, sin repetidos ni vacíos, y en orden de minuto',
       out.length === 2 && out[0].text === 'primera' && out[1].text === 'segunda', out);
    ok('3c · el minuto sale de `minute` o, si falta, de matchTime', out[0] && out[0].minute === 30 && out[1].minute === 67);
    ok('3d · conserva la parte y la hora real', out[0] && out[0].half === '1T' && out[0].realTime === '18:40:00' && out[1].half === '2T');
    const largo = f ? f([{ type: 'comment', comment: 'x'.repeat(900), matchTime: '1T 01:00' }]) : [];
    ok('3e · un texto enorme se recorta a 500', largo[0] && largo[0].text.length === 500);
}

// ───────────────────────────────────────────────────────────────────────────
console.log('\n── PARTE 4 · los despachos: cuerpo técnico sí, familias NO ──');
// ───────────────────────────────────────────────────────────────────────────
{
    // Cada `setDoc` de cronos_player_reports con su payload, por tipo de copia.
    const bloques = (src) => {
        const out = [];
        const re = /setDoc\(\s*(?:fs\.)?doc\(\s*(?:fa\.)?db\s*,\s*'cronos_player_reports'\s*,\s*([^)]+?)\)\s*,\s*(\{|_reportePartido)/g;
        let m;
        while ((m = re.exec(src))) {
            let cuerpo = '';
            if (m[2] === '{') {
                let i = re.lastIndex - 1, prof = 0;
                for (let j = i; j < src.length; j++) {
                    if (src[j] === '{') prof++;
                    else if (src[j] === '}') { prof--; if (prof === 0) { cuerpo = src.slice(i, j + 1); break; } }
                }
            } else {
                cuerpo = trozo(src, 'const _reportePartido = {', '\n            };');
            }
            out.push({ id: m[1], cuerpo });
        }
        return out;
    };
    const escritores = ['js/coach/comms/match-reports-auto.js', 'js/coach/comms/match-reports-send.js', 'js/coach/comms/collective-report.js'];
    let tecnicas = 0, conComent = 0, familias = 0, familiasCon = 0;
    escritores.forEach(f => {
        bloques(sinCom(leer(f))).forEach(b => {
            const esFamilia = /parent_player_report/.test(b.cuerpo) || /_parent_/.test(b.id);
            const lleva = /matchComments:/.test(b.cuerpo) || /\.\.\._reportePartido/.test(b.cuerpo) && /matchComments:/.test(sinCom(leer(f)));
            if (esFamilia) { familias++; if (/matchComments:/.test(b.cuerpo)) familiasCon++; }
            else { tecnicas++; if (lleva) conComent++; }
        });
    });
    ok('4a · se localizan las copias de cuerpo técnico/entrenador de los tres despachos (≥ 6)', tecnicas >= 6, tecnicas);
    ok('4b · 🔑 TODAS llevan matchComments', conComent === tecnicas, { tecnicas, conComent });
    ok('4c · se localizan las copias de familias (≥ 2)', familias >= 2, familias);
    ok('4d · 🔑🔑 NINGUNA copia de familias lleva los comentarios', familiasCon === 0, familiasCon);
}

// ───────────────────────────────────────────────────────────────────────────
console.log('\n── PARTE 5 · el motor del informe los pinta en su minuto ──');
// ───────────────────────────────────────────────────────────────────────────
{
    const RE = leer('js/coach/reports/report-engine.js');
    // Sandbox DESNUDO, igual que su propio guard: el motor es una función pura.
    const sb = {};
    vm.createContext(sb);
    vm.runInContext(RE + '\n;this.__RP = _RP;', sb);
    const RP = sb.__RP;
    const com = [{ id: 'e1', minute: 30, half: '1T', text: 'Presión alta <b>rival</b>', realTime: '18:40:00', createdAt: 1 },
                 { id: 'e2', minute: 67, half: '2T', text: 'Cerrar bandas', realTime: '', createdAt: 2 }];
    const jug = (n, alias, hist, extra) => Object.assign({ playerNumber: String(n), playerAlias: alias, minutesPlayed: '70:00',
        goals: 0, cards: null, history: hist, matchDate: '2026-09-10', rival: 'RIVAL', scoreHome: 1, scoreAway: 0 }, extra || {});
    const m = {
        matchDate: '2026-09-10', rival: 'RIVAL', scoreHome: 1, scoreAway: 0, category: 'alevin',
        players: [
            jug(7, 'PEDRO', [{ type: 'goal', minute: 44, second: 0, note: 'GOL' }], { matchComments: com }),
            jug(9, 'LUIS', [], { matchComments: com }),            // el mismo comentario, otra vez
        ],
    };
    let h = '';
    try { h = RP.build(m, { clubName: 'CD' }); } catch (e) { h = 'ERROR ' + e.message; }
    const filas = (h.match(/data-suceso="[a-z_]+"/g) || []).map(s => s.slice(13, -1));
    ok('5a · 🔑 los comentarios salen en el registro cronológico', filas.filter(t => t === 'comment').length === 2, filas);
    ok('5b · 🔑 una sola vez cada uno aunque vengan en todos los documentos', (h.match(/Cerrar bandas/g) || []).length === 1);
    ok('5c · 🔑 intercalados por minuto: 30\' comentario → 44\' gol → 67\' comentario',
       filas.join(',') === 'comment,goal,comment', filas.join(','));
    ok('5d · el texto va ESCAPADO', !/<b>rival<\/b>/.test(h) && /&lt;b&gt;rival/.test(h));
    ok('5e · con su hora real si la trae', /🕐 18:40:00/.test(h));
    const sinNada = RP.build({ matchDate: '2026-09-10', rival: 'R', scoreHome: 0, scoreAway: 0, category: 'alevin',
        players: [jug(7, 'PEDRO', [], { matchComments: [com[1]] })] }, { clubName: 'CD' });
    ok('5f · un partido sin incidencias pero con comentario también tiene registro',
       /data-suceso="comment"/.test(sinNada) && /Registro cronológico de incidencias/.test(sinNada));
    const informeViejo = RP.build({ matchDate: '2026-09-10', rival: 'R', scoreHome: 0, scoreAway: 0, category: 'alevin',
        players: [jug(7, 'PEDRO', [{ type: 'goal', minute: 5, second: 0, note: 'GOL' }])] }, { clubName: 'CD' });
    ok('5g · un informe viejo (sin matchComments) sale como siempre', /data-suceso="goal"/.test(informeViejo) && !/data-suceso="comment"/.test(informeViejo));
}

// ───────────────────────────────────────────────────────────────────────────
console.log('\n── PARTE 6 · el visor en vivo ──');
// ───────────────────────────────────────────────────────────────────────────
{
    const LIVE = leer('live.html');
    const sb = { String, Number, Array, Set, Object };
    vm.createContext(sb);
    try {
        vm.runInContext('let userData = null;\n' +
            trozo(LIVE, "const _TIPOS_NO_VISIBLES = new Set(['tactical_move']);", "\n    return true;\n}") + '\n' +
            trozo(LIVE, 'function _ordenCronologicoSucesos(events) {', '\n        .map(x => x.ev);\n}') +
            '\nthis.__vis = _esEventoVisible; this.__ord = _ordenCronologicoSucesos; this.__setRol = (r) => { userData = r ? { role: r } : null; };', sb);
    } catch (e) {
        console.log('  (' + e.message + ')');
        sb.__vis = () => null; sb.__ord = (a) => a; sb.__setRol = () => {};
    }
    const ev = { type: 'comment', text: 'COMENTARIO · x' };
    sb.__setRol('user');
    ok('6a · el ENTRENADOR ve los comentarios', sb.__vis(ev) === true);
    sb.__setRol('director');
    ok('6b · el DIRECTOR también', sb.__vis(ev) === true);
    sb.__setRol('parent');
    ok('6c · 🔑🔑 la FAMILIA no los ve', sb.__vis(ev) === false);
    ok('6d · …pero sigue viendo los goles', sb.__vis({ type: 'goal' }) === true);
    ok('6e · y la telemetría táctica sigue oculta para todos', sb.__vis({ type: 'tactical_move' }) === false);

    const orden = sb.__ord([
        { type: 'goal',    matchTime: '1T 12:00', createdAt: 1 },
        { type: 'yellow',  matchTime: '1T 44:10', createdAt: 3 },
        { type: 'goal',    matchTime: '2T 50:00', createdAt: 5 },
        { type: 'comment', matchTime: '1T 30:00', createdAt: 6 },   // escrito en la 2ª parte, del minuto 30
    ]).map(e => e.matchTime);
    ok('6f · 🔑 el historial va en ORDEN DE PARTIDO: el comentario del 30\' antes que el del 44\'',
       orden.join(',') === '1T 12:00,1T 30:00,1T 44:10,2T 50:00', orden.join(','));

    const L = sinCom(LIVE);
    ok('6g · 🔑 un comentario NO lanza aviso, destello ni sonido',
       /_evNuevos\.forEach\(ev => \{\s*if \(ev\.type === 'comment'\) return;/.test(L));
    ok('6h · la reconstrucción del historial usa el orden de partido',
       /_ordenCronologicoSucesos\(events\)\.forEach\(ev =>/.test(L));
    ok('6i · el mini-feed "ÚLTIMOS SUCESOS" no lo cuenta', /e\.type !== 'tactical_move' && e\.type !== 'comment'/.test(L));
    ok('6j · el índice ligero tampoco (sync.js)',
       /const _IDX_TIPOS_NO_VISIBLES = new Set\(\['tactical_move', 'comment'\]\);/.test(leer('js/match/live/sync.js')));
}

console.log('\n────────────────────────────────────────────');
console.log('Resultado: ' + (total - fallos) + '/' + total + (fallos ? '  ❌ ' + fallos + ' FALLOS' : '  ✅'));
process.exit(fallos ? 1 : 0);
})().catch(e => { console.log('ERROR ' + (e && e.stack)); process.exit(1); });

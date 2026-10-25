// ─────────────────────────────────────────────────────────────────────────
//  test_sucesos_en_lote.js  ·  📋 v799
//
//  Encargo del autor (implementar.txt 2026-10-11, captura 11304): en
//  «Registrar Evento Perdido / Offline»,
//    1 · «Añadir a la lista» sin guardar ni cerrar;
//    2 · una lista de pendientes donde revisar y BORRAR lo equivocado;
//    3 · «Guardar todos los sucesos», que inserta el lote entero y en orden
//        cronológico en el partido elegido.
//
//  Se EJECUTA el modal real (js/match/events/retroactive-modal.js) y, aparte,
//  la corrección de informes con un Firestore de mentira (mismo arnés que
//  test_retroactivo_naranja.js, PARTE 4).
// ─────────────────────────────────────────────────────────────────────────
'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.join(__dirname, '..');
const leer = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');
const RETRO = leer('js/match/events/retroactive-modal.js');

let fail = 0, pass = 0;
const ok = (name, cond, extra) => {
    if (cond) { pass++; console.log('PASS ' + name); }
    else { fail++; console.log('FAIL ' + name); if (extra !== undefined) console.log('       ' + JSON.stringify(extra).slice(0, 500)); }
};

const H = 3600e3;
function entorno({ confirma = true } = {}) {
    const els = {};
    const el = (id) => (els[id] = els[id] || { id, value: '', style: {}, innerHTML: '', textContent: '', focus() {} });
    const registrados = [], toasts = [], preguntas = [];
    const ctxLock = { window: {}, Date, Math, isNaN, console };
    vm.createContext(ctxLock);
    vm.runInContext(leer('js/match/immutability.js'), ctxLock);
    const sb = {
        console: { log() {}, warn() {}, error() {} },
        escapeHtml: (s) => String(s == null ? '' : s),
        showToast: (m) => toasts.push(String(m)),
        confirm: (m) => { preguntas.push(String(m)); return confirma; },
        Promise, String, Number, Array, Object, Date, JSON, Math, parseInt, isNaN, setTimeout, clearTimeout,   // 🧊 v836 · los topes de red
        _registerMatchEvent: (...a) => registrados.push(a),
        document: {
            getElementById: (id) => id === 'cronos-retroactive-modal' ? (els[id] || null) : el(id),
            createElement: () => ({ style: {}, innerHTML: '', className: '', id: '' }),
            body: { appendChild: (n) => { els['cronos-retroactive-modal'] = n; } },
        },
        liveMatchId: null,
        CronosMatchLock: ctxLock.window.CronosMatchLock,
        _cronosMatchEvents: [],
        renderPlayers() {}, updateMasterUI() {},
    };
    sb.window = sb;
    vm.createContext(sb);
    vm.runInContext(RETRO, sb);
    return { sb, el, els, registrados, toasts, preguntas };
}
const partido = () => ({
    id: 'M1', status: 'finished', finishedAt: new Date(Date.now() - 0.5 * H).toISOString(),
    myTeamRole: 'home', homeTeam: { name: 'CD PRUEBA', score: 0 }, awayTeam: { name: 'RIVAL', score: 0 },
    players: [
        { id: 1, number: '1', name: 'JUAN', team: 'home', status: 'field', goals: 0 },
        { id: 7, number: '7', name: 'FEFO', team: 'home', status: 'bench', goals: 0 },
        { id: 9, number: '9', name: 'NANO', team: 'home', status: 'field', goals: 0 },
    ],
});
// Rellena el formulario y pulsa «Añadir a la lista».
function apunta(E, tipo, half, minute, campos) {
    E.sb._setRetroEventType(tipo);
    E.el('retro-half-select').value = half;
    E.el('retro-minute-input').value = String(minute);
    Object.keys(campos || {}).forEach(k => { E.el(k).value = campos[k]; });
    E.sb._retroAnadirALista();
}

(async () => {
    console.log('\n── PARTE 1 · apuntar, revisar y borrar sin guardar ──');
    {
        const E = entorno();
        const p = partido();
        await E.sb.openRetroactiveEventModal('M1', p);
        const html = E.els['cronos-retroactive-modal'].innerHTML;
        ok('1a · 🔑 existe «➕ Añadir a la lista», DENTRO del formulario (se apaga con él)',
           /id="retro-add-btn"[^>]*>\s*➕ Añadir a la lista/.test(html) &&
           html.indexOf('id="retro-add-btn"') > html.indexOf('id="retro-form-body"') &&
           html.indexOf('id="retro-add-btn"') < html.indexOf('id="retro-lote"'));
        ok('1b · y el hueco de la lista va ANTES de Guardar',
           html.indexOf('id="retro-lote"') < html.indexOf('id="retro-save-btn"'));

        apunta(E, 'goal',   '2T', 40, { 'retro-player-select': '9' });
        apunta(E, 'yellow', '1T', 10, { 'retro-player-select': '1' });
        apunta(E, 'comment','1T', 20, { 'retro-comment-input': 'Presión alta' });
        apunta(E, 'injury', '1T', 5,  { 'retro-player-select': '7' });
        ok('1c · 🔑 añadir NO registra nada todavía', E.registrados.length === 0, E.registrados.length);
        ok('1d · y el modal sigue abierto', E.els['cronos-retroactive-modal'].style.display === 'flex');
        const lista = E.el('retro-lote').innerHTML;
        ok('1e · la lista enseña los 4, cada uno con su ✕', (lista.match(/_retroQuitarDeLista\(/g) || []).length === 4, lista.slice(0, 300));
        ok('1f · 🔑 ordenados por parte y minuto (1T 05 → 1T 10 → 1T 20 → 2T 40)',
           lista.indexOf("1T 05'") < lista.indexOf("1T 10'") && lista.indexOf("1T 10'") < lista.indexOf("1T 20'") &&
           lista.indexOf("1T 20'") < lista.indexOf("2T 40'"));
        ok('1g · con quién y qué: «#9 NANO», «#1 JUAN» y el comentario',
           /#9 NANO/.test(lista) && /#1 JUAN/.test(lista) && /Presión alta/.test(lista));
        ok('1h · el botón Guardar dice cuántos van', /Guardar todos los sucesos \(4\)/.test(E.el('retro-save-btn').innerHTML));
        ok('1i · el texto del comentario se vacía al apuntarlo (no se duplica la nota)',
           E.el('retro-comment-input').value === '');

        // ── borrar uno ──
        const uidLesion = (lista.match(/_retroQuitarDeLista\('([^']+)'\)/) || [])[1];   // el primero = 1T 05 lesión
        E.sb._retroQuitarDeLista(uidLesion);
        const lista2 = E.el('retro-lote').innerHTML;
        ok('1j · 🔑 ✕ quita ESE suceso y sólo ése', (lista2.match(/_retroQuitarDeLista\(/g) || []).length === 3 &&
           !/1T 05'/.test(lista2) && /2T 40'/.test(lista2));

        // ── un minuto no válido NO entra ──
        E.toasts.length = 0;
        apunta(E, 'goal', '1T', 'abc', { 'retro-player-select': '1' });
        ok('1k · un minuto no válido no entra en la lista y se avisa',
           (E.el('retro-lote').innerHTML.match(/_retroQuitarDeLista\(/g) || []).length === 3 &&
           /minuto válido/.test(E.toasts.join('|')));

        console.log('\n── PARTE 2 · guardar el lote, en orden ──');
        E.toasts.length = 0;
        await E.sb.submitRetroactiveEvent();
        const tipos = E.registrados.map(r => r[0] + '@' + r[3]);
        ok('2a · 🔑🔑 se registran los 3, en ORDEN CRONOLÓGICO (no en el de apunte)',
           JSON.stringify(tipos) === JSON.stringify(['yellow@1T 10:00', 'comment@1T 20:00', 'goal@2T 40:00']), tipos);
        ok('2b · 🔑 todos contra el partido elegido', E.registrados.every(r => r[5] && r[5].matchId === 'M1'));
        ok('2c · marcados como posteriores al partido', E.registrados.every(r => r[4] && r[4].retro === true && r[4].addedAfterMatch === true));
        ok('2d · el lesionado BORRADO no se registra', !E.registrados.some(r => r[0] === 'injury'));
        ok('2e · el gol suma en la ficha y en el marcador del partido',
           p.players.find(x => x.id === 9).goals === 1 && p.homeTeam.score === 1);
        ok('2f · la amarilla queda en la ficha de JUAN', p.players.find(x => x.id === 1).cards === 'amarilla');

        console.log('\n── PARTE 3 · si el INFORME falla, no se duplica nada ──');
        // En este arnés no hay Firestore: la corrección del informe falla, que
        // es justo el caso a vigilar.
        ok('3a · 🔑 se avisa con el número de sucesos y de que el informe no se actualizó',
           /3 sucesos registrados, pero .*informe/.test(E.toasts.join('|')), E.toasts);
        ok('3b · el modal se queda abierto con «Reintentar el informe»',
           E.els['cronos-retroactive-modal'].style.display === 'flex' &&
           /_retroReintentarInforme\(\)/.test(E.el('retro-lote').innerHTML));
        ok('3c · y la lista de pendientes queda vacía (ya están registrados)',
           !/_retroQuitarDeLista\(/.test(E.el('retro-lote').innerHTML));
        const antes = E.registrados.length;
        await E.sb._retroReintentarInforme();
        ok('3d · 🔑🔑 reintentar NO vuelve a registrar los sucesos (los duplicaría)', E.registrados.length === antes);
    }

    console.log('\n── PARTE 4 · lo que protege el lote ──');
    {
        // Con la lista VACÍA el botón guarda el suceso del formulario, como antes.
        const E = entorno();
        await E.sb.openRetroactiveEventModal('M1', partido());
        E.sb._setRetroEventType('goal');   // 🎬 v817 · el modal abre sin tipo
        E.el('retro-player-select').value = '1';
        E.el('retro-minute-input').value = '12';
        await E.sb.submitRetroactiveEvent();
        ok('4a · con la lista vacía, Guardar registra el suceso del formulario (un clic, como siempre)',
           E.registrados.length === 1 && E.registrados[0][0] === 'goal');
    }
    {
        // 🎬 v817 · pulsar otra vez el tipo activo lo QUITA, y sin tipo ni vídeo
        // no se registra nada (antes «Gol» venía marcado y no se podía quitar).
        const E = entorno();
        await E.sb.openRetroactiveEventModal('M1', partido());
        E.el('retro-player-select').value = '1';
        await E.sb.submitRetroactiveEvent();
        ok('4a2 · 🔑 el modal abre SIN tipo: sin vídeo no registra nada y lo dice',
           E.registrados.length === 0 && /Elige un tipo de suceso o un vídeo/.test(E.toasts.join('|')), E.toasts);
        E.sb._setRetroEventType('goal');
        E.sb._setRetroEventType('goal');
        await E.sb.submitRetroactiveEvent();
        ok('4a3 · 🔑 Gol pulsado dos veces queda QUITADO (no se registra un gol)',
           E.registrados.length === 0, E.registrados);
    }
    {
        // Cambiar de partido con pendientes: se pregunta; si no, se queda.
        const E = entorno({ confirma: false });
        await E.sb.openRetroactiveEventModal('M1', partido());
        apunta(E, 'goal', '1T', 3, { 'retro-player-select': '1' });
        E.el('retro-match-select').value = 'OTRO';
        await E.sb._retroElegirPartido('OTRO');
        ok('4b · 🔑 cambiar de partido con sucesos en la lista PREGUNTA',
           E.preguntas.some(q => /SIN GUARDAR/.test(q) && /Cambiar de partido/.test(q)));
        ok('4c · y si no se acepta, el desplegable vuelve al partido del lote y la lista sigue',
           E.el('retro-match-select').value === 'M1' && /_retroQuitarDeLista\(/.test(E.el('retro-lote').innerHTML));
        E.sb.closeRetroactiveEventModal();
        ok('4d · 🔑 cerrar con pendientes también pregunta, y si no se acepta NO cierra',
           E.preguntas.some(q => /Cerrar y descartarlos/.test(q)) &&
           E.els['cronos-retroactive-modal'].style.display === 'flex');
    }
    {
        // Si el permiso caduca con la lista llena, el lote no se pierde.
        const E = entorno();
        const p = partido();
        await E.sb.openRetroactiveEventModal('M1', p);
        apunta(E, 'goal', '1T', 3, { 'retro-player-select': '1' });
        p.finishedAt = new Date(Date.now() - 5 * H).toISOString();   // vence la ventana con el modal abierto
        await E.sb.submitRetroactiveEvent();
        ok('4e · 🔑 si el partido se cierra con la lista llena: no se guarda NI se pierde la lista',
           E.registrados.length === 0 && /_retroQuitarDeLista\(/.test(E.el('retro-lote').innerHTML) &&
           E.els['cronos-retroactive-modal'].style.display === 'flex');
    }

    console.log('\n── PARTE 5 · el informe recibe el lote en UNA escritura ──');
    {
        const trozo = (src, inicio) => {
            const i = src.indexOf(inicio);
            if (i < 0) return '';
            let n = 0, j = src.indexOf('{', i);
            for (let k = j; k < src.length; k++) {
                if (src[k] === '{') n++;
                else if (src[k] === '}') { n--; if (n === 0) return src.slice(i, k + 1); }
            }
            return '';
        };
        const fn = trozo(RETRO, 'async function _corrigeInformesDelPartido(cambio)');
            // 🧊 v836 · la función usa los topes de red del módulo: van con ella.
            const _topesSrc = RETRO.slice(RETRO.indexOf('    const _TOPE_LECTURA'), RETRO.indexOf('    const _esTope = (e) =>')) +
                              "const _esTope = (e) => !!(e && e.code === 'cronos/tope');\n";
        const docs = [
            { id: 'M_staff_p9',  data: { playerNumber: '9', goals: 1, scoreHome: 1, scoreAway: 0, staffReport: true, history: [] } },
            { id: 'M_parent_p9', data: { playerNumber: '9', goals: 1, scoreHome: 1, scoreAway: 0, type: 'parent_player_report' } },
            { id: 'M_staff_p7',  data: { playerNumber: '7', goals: 0, scoreHome: 1, scoreAway: 0, staffReport: true } },
            { id: 'M_staff_p1',  data: { playerNumber: '1', goals: 0, scoreHome: 1, scoreAway: 0, cards: null, staffReport: true } },
        ];
        const escrituras = []; let lotes = 0, commits = 0;
        const ctx = { console: { warn() {}, log() {} }, String, Number, Object, Date, Array, Promise, Map, setTimeout, clearTimeout, _targetMatchData: null, // v817
                      _targetMatchId: 'M', window: { _cronos_auth: { db: {} } } };
        ctx.__imp = async () => ({
            collection: () => ({}), where: () => ({}), query: () => ({}),
            getDocs: async () => ({ empty: false, forEach: (cb) => docs.forEach(d => cb({ ref: d.id, data: () => d.data })) }),
            writeBatch: () => { lotes++; return { update: (ref, upd) => escrituras.push({ ref, upd }), commit: async () => { commits++; } }; },
            arrayUnion: (...x) => ({ __au: x }),
        });
        vm.createContext(ctx);
        vm.runInContext(_topesSrc + fn.replace(/\bimport\s*\(/g, '__imp(') + ';\n;globalThis.corrige = _corrigeInformesDelPartido;', ctx);
        const r = await ctx.corrige([
            { tipo: 'goal',   ladoGol: 'home', dorsal: '9', apunte: { type: 'goal', minute: 10, retro: true } },
            { tipo: 'goal',   ladoGol: 'home', dorsal: '9', apunte: { type: 'goal', minute: 30, retro: true } },
            { tipo: 'goal',   ladoGol: 'away', dorsal: null, apunte: null },
            { tipo: 'yellow', ladoGol: null, dorsal: '1', apunte: { type: 'yellow', minute: 12, retro: true } },
            { tipo: 'yellow', ladoGol: null, dorsal: '1', apunte: { type: 'yellow', minute: 50, retro: true } },
            { tipo: 'sub',    ladoGol: null, dorsal: '9', apunte: { type: 'sub_out', retro: true },
              dorsalEntra: '7', apunteEntra: { type: 'sub_in', retro: true } },
            { tipo: 'comment', comentario: { text: 'nota', retro: true } },
        ]);
        const de = (id) => (escrituras.find(e => e.ref === id) || {}).upd || {};
        ok('5a · la corrección del lote se da por buena', r === true);
        ok('5b · 🔑🔑 UN solo lote y UN commit para los 7 sucesos', lotes === 1 && commits === 1, { lotes, commits });
        ok('5c · 🔑 una escritura por documento, no una por suceso', escrituras.length === docs.length, escrituras.length);
        ok('5d · 🔑 el marcador SUMA el lote: 1-0 → 3-1 en todas las copias',
           escrituras.every(e => e.upd.scoreHome === 3 && e.upd.scoreAway === 1), escrituras.map(e => [e.upd.scoreHome, e.upd.scoreAway]));
        ok('5e · los DOS goles de NANO suman en sus copias (1 → 3)', de('M_staff_p9').goals === 3 && de('M_parent_p9').goals === 3);
        ok('5f · dos amarillas a JUAN = roja (como en directo)', de('M_staff_p1').cards === 'roja');
        ok('5g · 🔑 todos los apuntes de NANO en UN arrayUnion (2 goles + sale)',
           de('M_staff_p9').history && de('M_staff_p9').history.__au.length === 3);
        ok('5h · 🔄 el que ENTRA en el cambio recibe SU apunte (antes no llegaba)',
           de('M_staff_p7').history && de('M_staff_p7').history.__au[0].type === 'sub_in');
        ok('5i · el comentario a staff, NUNCA a la familia (v690)',
           de('M_staff_p9').matchComments && !de('M_parent_p9').matchComments);
        ok('5j · y un suceso suelto sigue funcionando (la forma de siempre)',
           (escrituras.length = 0, await ctx.corrige({ tipo: 'goal', ladoGol: 'away', dorsal: '9' })) === true &&
           escrituras.every(e => e.upd.scoreAway === 1));
    }

    console.log('\n────────────────────────────────────────────');
    console.log('Resultado: ' + pass + '/' + (pass + fail) + (fail ? '  ❌ ' + fail + ' FALLOS' : '  ✅'));
    process.exit(fail ? 1 : 0);
})();

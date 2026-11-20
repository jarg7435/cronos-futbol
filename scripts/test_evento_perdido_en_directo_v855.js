// ═══════════════════════════════════════════════════════════════════════════
//  ⚽⏱️ v855 · «REGISTRAR EVENTO PERDIDO» DESDE EL DIRECTO: EL PARTIDO EN CURSO
//            VIENE FIJADO, Y PARTE Y MINUTO SALEN DEL RELOJ
// ═══════════════════════════════════════════════════════════════════════════
//  Encargo del autor (implementar.txt 2026-11-20, captura IMG_0759): desde el
//  panel de un partido en directo el modal abría en «— Elige el partido —»,
//  con «⏳ Cargando los últimos partidos de tu equipo…» y el formulario APAGADO
//  («Sin partido no se puede registrar nada»). El partido en curso sólo entraba
//  en el desplegable cuando terminaba de cargar la lista de informes, y con
//  mala cobertura no terminaba nunca. Además, con el partido en la 2ª parte,
//  proponía «1ª Parte» y el minuto 30.
//
//  Este guard EJECUTA js/match/events/retroactive-modal.js en un sandbox y
//  comprueba, con la lista de partidos COLGADA a propósito (la red no
//  responde), que el entrenador puede registrar sobre el partido en curso.
// ═══════════════════════════════════════════════════════════════════════════
'use strict';
const fs   = require('fs');
const path = require('path');
const vm   = require('vm');

const ROOT = path.join(__dirname, '..');
const leer = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');
let pass = 0, fail = 0;
const ok = (name, cond, extra) => {
    if (cond) { pass++; console.log('PASS ' + name); }
    else { fail++; console.log('FAIL ' + name); if (extra !== undefined) console.log('       ' + JSON.stringify(extra).slice(0, 500)); }
};

const ctxLock = { window: {}, Date, Math, isNaN, console };
vm.createContext(ctxLock);
vm.runInContext(leer('js/match/immutability.js'), ctxLock);
const LOCK = ctxLock.window.CronosMatchLock;

// `listaColgada`: la lectura de informes NO responde nunca (cobertura mala).
function entorno({ enCurso = null, fase = '1st_half', h1 = 0, h2 = 0, conRed = true } = {}) {
    const els = {};
    const el = (id) => (els[id] = els[id] || { id, value: '', style: {}, innerHTML: '', textContent: '',
                                               focus() {}, options: [], selectedIndex: 0 });
    const registrados = [], toasts = [];
    const sb = {
        console: { log() {}, warn() {}, error() {} },
        escapeHtml: (s) => String(s == null ? '' : s),
        showToast: (m) => toasts.push(String(m)),
        Promise, String, Number, Array, Object, Date, JSON, Math, parseInt, isNaN, setTimeout, clearTimeout,
        _registerMatchEvent: (...a) => registrados.push(a),
        document: {
            getElementById: (id) => id === 'cronos-retroactive-modal' ? (els[id] || null) : el(id),
            createElement: () => ({ style: {}, innerHTML: '', className: '', id: '' }),
            body: { appendChild: (n) => { els['cronos-retroactive-modal'] = n; } },
        },
        liveMatchId: enCurso,
        matchPhase: fase,
        masterTimeH1: h1,
        masterTimeH2: h2,
        players: [
            { id: 1, number: '1', name: 'OMAR', team: 'home', status: 'field', goals: 0 },
            { id: 11, number: '11', name: 'CHRISTIAN', team: 'home', status: 'bench', goals: 0 },
        ],
        CronosMatchLock: LOCK,
        _cronosMatchEvents: [],
        // Con la «red» puesta, la lista de partidos se queda colgada para
        // siempre: es justo el «Cargando…» eterno de la captura.
        _cronos_auth: conRed ? { db: {} } : null,
        _cronosCurrentUser: { uid: 'coach-1', clubName: 'CD PRUEBA' },
        renderPlayers() {}, updateMasterUI() {},
    };
    sb.window = sb;
    vm.createContext(sb);
    let src = leer('js/match/events/retroactive-modal.js');
    // La importación del SDK no existe en Node: se cuelga, como sin cobertura.
    src = src.replace(/await import\(_FS_URL\)/g, 'await new Promise(() => {})');
    vm.runInContext(src, sb);
    return { sb, el, els, registrados, toasts };
}
const html = (E) => (E.els['cronos-retroactive-modal'] || {}).innerHTML || '';

(async () => {
console.log('── PARTE 1 · abierto desde el directo, el partido en curso viene fijado ──');
{
    // Partido sin competición: el id es el de cualquier amistoso.
    const E = entorno({ enCurso: 'cd-prueba-amistoso-20112026-1730', fase: '2nd_half',
                        h1: 39 * 60 + 13, h2: 32 * 60 + 23 });
    const t0 = Date.now();
    await E.sb.openRetroactiveEventModal();          // como el botón ⏱️ PERDIDOS
    const ms = Date.now() - t0;
    const h = html(E);
    ok('1a · 🔑 abre SIN esperar a la lista de partidos (colgada a propósito)', ms < 500, ms + ' ms');
    ok('1b · 🔑 el partido en curso viene SELECCIONADO en el desplegable',
       /<option value="cd-prueba-amistoso-20112026-1730" selected>🟢 Partido en curso/.test(h));
    ok('1c · y ya no arranca en «— Elige el partido —»',
       !/<option value="" selected>/.test(h));
    ok('1d · 🔑 el formulario está ENCENDIDO y Guardar activo',
       E.el('retro-form-body').style.pointerEvents === 'auto' && E.el('retro-save-btn').disabled === false,
       { pe: E.el('retro-form-body').style.pointerEvents, dis: E.el('retro-save-btn').disabled });
    ok('1e · el recuadro dice «Partido en curso», no «Elige primero»',
       /Partido en curso/.test(E.el('retro-match-status').innerHTML) &&
       !/Elige primero/.test(E.el('retro-match-status').innerHTML));

    console.log('\n── PARTE 2 · parte y minuto según el reloj ──');
    ok('2a · 🔑 en la 2ª parte propone «2ª Parte (2T)»',
       /<option value="2T" selected>2ª Parte/.test(h) && !/<option value="1T" selected>/.test(h));
    ok('2b · 🔑 y el minuto ACUMULADO del reloj (39:13 + 32:23 → 71), como el directo',
       /id="retro-minute-input"[^>]*value="71"/.test(h));

    console.log('\n── PARTE 3 · se guarda directamente sobre el partido en curso ──');
    E.sb._setRetroEventType('goal');
    E.el('retro-player-select').value = '1';
    E.el('retro-half-select').value = '2T';
    E.el('retro-minute-input').value = '71';
    await E.sb.submitRetroactiveEvent();
    const r = E.registrados[0] || [];
    ok('3a · 🔑 el gol se registra sin elegir nada más', r[0] === 'goal', r);
    ok('3b · sin el aviso «Elige primero el partido»', !E.toasts.some(t => /Elige primero el partido/.test(t)), E.toasts);
    ok('3c · con la parte y el minuto del formulario', JSON.stringify(r).indexOf('2T 71') >= 0, r);
    ok('3d · y en el partido en curso, no en otro',
       !r[5] || !r[5].matchId || r[5].matchId === 'cd-prueba-amistoso-20112026-1730', r[5]);
}
{
    const E = entorno({ enCurso: 'en-curso-1', fase: '1st_half', h1: 12 * 60 + 40 });
    await E.sb.openRetroactiveEventModal();
    const h = html(E);
    ok('2c · en la 1ª parte propone «1ª Parte (1T)» y el minuto 12',
       /<option value="1T" selected>/.test(h) && /id="retro-minute-input"[^>]*value="12"/.test(h));
}
{
    const E = entorno({ enCurso: 'en-curso-1', fase: 'break', h1: 30 * 60 + 5 });
    await E.sb.openRetroactiveEventModal();
    const h = html(E);
    ok('2d · en el descanso, 1T con el tiempo de la 1ª (misma regla que el directo)',
       /<option value="1T" selected>/.test(h) && /id="retro-minute-input"[^>]*value="30"/.test(h));
}
{
    const E = entorno({ enCurso: 'en-curso-1', fase: '1st_half', h1: 0 });
    await E.sb.openRetroactiveEventModal();
    ok('2e · recién empezado el minuto nunca es 0 (el campo va de 1 a 120)',
       /id="retro-minute-input"[^>]*value="1"/.test(html(E)));
}
{
    const E = entorno({ enCurso: 'en-curso-1', fase: '2nd_half', h1: 45 * 60, h2: 90 * 60 });
    await E.sb.openRetroactiveEventModal();
    ok('2f · un reloj desbordado se queda en 120 (el tope del campo)',
       /id="retro-minute-input"[^>]*value="120"/.test(html(E)));
}

console.log('\n── PARTE 4 · lo que NO cambia ──');
{
    const E = entorno({ enCurso: null });
    await E.sb.openRetroactiveEventModal();
    ok('4a · sin partido en curso sigue obligando a elegir (v797)',
       /<option value="" selected>— Elige el partido —<\/option>/.test(html(E)) &&
       E.el('retro-save-btn').disabled === true);
}
{
    const E = entorno({ enCurso: 'en-curso-1', fase: 'finished', h1: 1800, h2: 1800 });
    await E.sb.openRetroactiveEventModal();
    ok('4b · 🔑 un partido ya TERMINADO en la pestaña no se fija solo',
       /<option value="" selected>— Elige el partido —<\/option>/.test(html(E)));
}
{
    const E = entorno({ enCurso: 'en-curso-1', fase: '2nd_half', h1: 1800, h2: 600, conRed: false });
    const fin = { id: 'M1', status: 'finished', finishedAt: new Date(Date.now() - 3600 * 1000).toISOString(),
                  myTeamRole: 'home', homeTeam: { name: 'CD PRUEBA', score: 1 }, awayTeam: { name: 'RIVAL', score: 0 },
                  players: [] };
    await E.sb.openRetroactiveEventModal('M1', fin);
    const h = html(E);
    ok('4c · 🔑 abierto desde Partidos Terminados manda el partido que se pasa, no el en curso',
       /<option value="M1" selected>/.test(h) && !/<option value="en-curso-1" selected>/.test(h));
    ok('4d · y para ese partido la parte/minuto NO salen del reloj del en curso (1T · 30)',
       /<option value="1T" selected>/.test(h) && /id="retro-minute-input"[^>]*value="30"/.test(h));
}

console.log('\n' + pass + '/' + (pass + fail) + ' OK');
process.exit(fail ? 1 : 0);
})();

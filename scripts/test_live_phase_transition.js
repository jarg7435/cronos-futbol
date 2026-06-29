// Test de la lógica de transición de fase (silbato + overlay) de live.html.
// Extrae los CUERPOS REALES de _effectivePhase y _handlePhaseTransition del
// archivo y los ejecuta en un sandbox con dependencias mockeadas. Verifica:
//  1. Siembra sin disparar la primera vez.
//  2. 1ª parte -> DESCANSO: silbato(2) + overlay FINAL DE PRIMERA PARTE.
//  3. 2ª parte -> FIN (status='finished'): silbato(3) + overlay FINAL DEL PARTIDO.
//  4. Modo autónomo: agotamiento por reloj (phaseStartedAt) sin cambio de status.
//  5. Sin duplicado: misma fase repetida no dispara.
//  6. break -> 2nd_half no dispara.
//  7. Modo silencio: overlay SIEMPRE; silbato se salta.
//  8. navigable: partido abierto (currentMatchId) sin botón; en fondo con botón.
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const html = fs.readFileSync(path.join(__dirname, '..', 'live.html'), 'utf8');

// Extrae `function NOMBRE(...) { ... }` balanceando llaves.
function extractFn(src, name) {
    const start = src.indexOf('function ' + name + '(');
    if (start < 0) throw new Error('No encontrada: ' + name);
    let i = src.indexOf('{', start);
    let depth = 0;
    for (; i < src.length; i++) {
        if (src[i] === '{') depth++;
        else if (src[i] === '}') { depth--; if (depth === 0) { i++; break; } }
    }
    return src.slice(start, i);
}

const fnEffective = extractFn(html, '_effectivePhase');
const fnHandle    = extractFn(html, '_handlePhaseTransition');

let results = [];
function check(name, cond) {
    results.push({ name, ok: !!cond });
    console.log((cond ? 'PASS' : 'FAIL') + ' - ' + name);
}

function makeSandbox() {
    const sandbox = {
        _matchLastData: {},
        _matchPrevPhase: {},
        currentMatchId: null,
        _alertsMuted: false,
        whistleCalls: [],
        enqueued: [],
        Date,
        Math,
        console,
        _liveWhistle: function(times) {
            // Réplica del gate de silencio del _liveWhistle real: si mute, no suena.
            if (sandbox._alertsMuted) return;
            sandbox.whistleCalls.push(times);
        },
        _enqueueMoment: function(opts) { sandbox.enqueued.push(opts); },
    };
    vm.createContext(sandbox);
    vm.runInContext(fnEffective + '\n' + fnHandle, sandbox);
    return sandbox;
}

const F7_BREAK_LIMIT = (30 * 60) + 600;   // maxTime + descuento F7 = 2400s

// ── 1+2: siembra + 1ª parte -> DESCANSO ───────────────────────────
{
    const s = makeSandbox();
    const data1 = { status: 'active', phase: '1st_half', homeTeam:{name:'A',score:1}, awayTeam:{name:'B',score:0} };
    vm.runInContext('_handlePhaseTransition("m1", ' + JSON.stringify(data1) + ')', s);
    check('1. primera vez NO dispara (siembra)', s.whistleCalls.length === 0 && s.enqueued.length === 0);
    check('1b. _matchPrevPhase sembrado a 1st_half', s._matchPrevPhase.m1 === '1st_half');

    const data2 = { status: 'active', phase: 'break', homeTeam:{name:'A',score:1}, awayTeam:{name:'B',score:0} };
    vm.runInContext('_handlePhaseTransition("m1", ' + JSON.stringify(data2) + ')', s);
    check('2. 1ªP->DESCANSO dispara silbato(2)', s.whistleCalls.length === 1 && s.whistleCalls[0] === 2);
    check('2b. overlay FINAL DE PRIMERA PARTE', s.enqueued.length === 1 && s.enqueued[0].title === 'FINAL DE PRIMERA PARTE');
}

// ── 3: 2ª parte -> FIN (status='finished') ─────────────────────────
{
    const s = makeSandbox();
    const d1 = { status: 'active', phase: '2nd_half', homeTeam:{name:'A',score:2}, awayTeam:{name:'B',score:2} };
    vm.runInContext('_handlePhaseTransition("m2", ' + JSON.stringify(d1) + ')', s);
    const d2 = { status: 'finished', phase: '2nd_half', homeTeam:{name:'A',score:2}, awayTeam:{name:'B',score:2} };
    vm.runInContext('_handlePhaseTransition("m2", ' + JSON.stringify(d2) + ')', s);
    check('3. 2ªP->FIN dispara silbato(3)', s.whistleCalls.length === 1 && s.whistleCalls[0] === 3);
    check('3b. overlay FINAL DEL PARTIDO', s.enqueued.length === 1 && s.enqueued[0].title === 'FINAL DEL PARTIDO');
}

// ── 4: modo autónomo (agotamiento por reloj, status sigue 'active') ─
{
    const s = makeSandbox();
    // Siembra en 1ª parte recién empezada (no agotada).
    const fresh = { status:'active', phase:'1st_half', isRunning:true, mode:'f7',
        phaseStartedAt: Date.now() - 10*1000, homeTeam:{name:'A',score:0}, awayTeam:{name:'B',score:0} };
    vm.runInContext('_handlePhaseTransition("m3", ' + JSON.stringify(fresh) + ')', s);
    check('4a. autónomo recién empezado siembra 1st_half', s._matchPrevPhase.m3 === '1st_half' && s.whistleCalls.length === 0);
    // Mismo snapshot pero phaseStartedAt agotado: el reloj cruzó el límite.
    const expired = { status:'active', phase:'1st_half', isRunning:true, mode:'f7',
        phaseStartedAt: Date.now() - (F7_BREAK_LIMIT + 5)*1000, homeTeam:{name:'A',score:0}, awayTeam:{name:'B',score:0} };
    vm.runInContext('_handlePhaseTransition("m3", ' + JSON.stringify(expired) + ')', s);
    check('4b. autónomo agotado -> DESCANSO + silbato(2)', s._matchPrevPhase.m3 === 'break' && s.whistleCalls.length === 1 && s.whistleCalls[0] === 2);
}

// ── 5: misma fase repetida no dispara ──────────────────────────────
{
    const s = makeSandbox();
    const d = { status:'active', phase:'1st_half', homeTeam:{name:'A',score:0}, awayTeam:{name:'B',score:0} };
    vm.runInContext('_handlePhaseTransition("m4", ' + JSON.stringify(d) + ')', s);
    vm.runInContext('_handlePhaseTransition("m4", ' + JSON.stringify(d) + ')', s);
    vm.runInContext('_handlePhaseTransition("m4", ' + JSON.stringify(d) + ')', s);
    check('5. fase repetida no dispara', s.whistleCalls.length === 0 && s.enqueued.length === 0);
}

// ── 6: break -> 2nd_half no dispara ────────────────────────────────
{
    const s = makeSandbox();
    const b = { status:'active', phase:'break', homeTeam:{name:'A',score:0}, awayTeam:{name:'B',score:0} };
    vm.runInContext('_handlePhaseTransition("m5", ' + JSON.stringify(b) + ')', s);
    const h2 = { status:'active', phase:'2nd_half', homeTeam:{name:'A',score:0}, awayTeam:{name:'B',score:0} };
    vm.runInContext('_handlePhaseTransition("m5", ' + JSON.stringify(h2) + ')', s);
    check('6. DESCANSO->2ªP no dispara', s.whistleCalls.length === 0 && s.enqueued.length === 0);
}

// ── 7: modo silencio: overlay SÍ, silbato NO ───────────────────────
{
    const s = makeSandbox();
    s._alertsMuted = true;
    const d1 = { status:'active', phase:'1st_half', homeTeam:{name:'A',score:0}, awayTeam:{name:'B',score:0} };
    vm.runInContext('_handlePhaseTransition("m6", ' + JSON.stringify(d1) + ')', s);
    const d2 = { status:'active', phase:'break', homeTeam:{name:'A',score:0}, awayTeam:{name:'B',score:0} };
    vm.runInContext('_handlePhaseTransition("m6", ' + JSON.stringify(d2) + ')', s);
    check('7. silencio: silbato saltado', s.whistleCalls.length === 0);
    check('7b. silencio: overlay SIEMPRE mostrado', s.enqueued.length === 1);
}

// ── 8: navigable según partido abierto vs fondo ────────────────────
{
    const s = makeSandbox();
    s.currentMatchId = 'open';
    // Partido ABIERTO -> navigable=false, subtítulo informativo del entrenador.
    const o1 = { status:'active', phase:'1st_half', homeTeam:{name:'A',score:0}, awayTeam:{name:'B',score:0} };
    vm.runInContext('_handlePhaseTransition("open", ' + JSON.stringify(o1) + ')', s);
    const o2 = { status:'active', phase:'break', homeTeam:{name:'A',score:0}, awayTeam:{name:'B',score:0} };
    vm.runInContext('_handlePhaseTransition("open", ' + JSON.stringify(o2) + ')', s);
    check('8. partido abierto: navigable=false', s.enqueued.length === 1 && s.enqueued[0].navigable === false);

    // Partido en FONDO -> navigable=true, subtítulo con marcador.
    const b1 = { status:'active', phase:'1st_half', homeTeam:{name:'CD DÍA 2',score:1}, awayTeam:{name:'VISITANTE',score:0} };
    vm.runInContext('_handlePhaseTransition("bg", ' + JSON.stringify(b1) + ')', s);
    const b2 = { status:'active', phase:'break', homeTeam:{name:'CD DÍA 2',score:1}, awayTeam:{name:'VISITANTE',score:0} };
    vm.runInContext('_handlePhaseTransition("bg", ' + JSON.stringify(b2) + ')', s);
    const bgOverlay = s.enqueued[1];
    check('8b. partido fondo: navigable=true', bgOverlay && bgOverlay.navigable === true && bgOverlay.matchId === 'bg');
    check('8c. fondo: subtítulo con equipos + marcador', bgOverlay && /CD DÍA 2 1 · 0 VISITANTE/.test(bgOverlay.subtitle));
}

const failed = results.filter(r => !r.ok);
console.log('\n' + (results.length - failed.length) + '/' + results.length + ' OK');
if (failed.length) { console.error('FALLOS: ' + failed.map(f => f.name).join(', ')); process.exit(1); }

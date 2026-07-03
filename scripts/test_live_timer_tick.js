// E6 — Verificación empírica del cronómetro de live.html (espectador).
//
// Reproduce el FLUJO REAL en headless: extrae los cuerpos REALES de live.html
// (renderMatch + su setInterval de 250ms, y el setInterval de la lista) y los
// ejecuta en un sandbox con un reloj falso que avanza en pasos pequeños,
// INTERCALANDO la llegada de snapshots (renderMatch) con los ticks del
// intervalo, igual que en producción. Captura el texto de #live-timer en cada
// segundo simulado y verifica que AVANZA segundo a segundo (no a saltos ni
// congelado).
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const html = fs.readFileSync(path.join(__dirname, '..', 'live.html'), 'utf8');

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

// Cuerpo de la función flecha de un `VAR = setInterval(() => { ... }, MS)`.
function extractIntervalBody(scopeSrc, ms) {
    const anchor = 'setInterval(() => {';
    let from = 0, start;
    while ((start = scopeSrc.indexOf(anchor, from)) >= 0) {
        // Comprobar que termina con `}, ms)`
        let i = start + anchor.length, depth = 1;
        const bodyStart = i;
        for (; i < scopeSrc.length; i++) {
            if (scopeSrc[i] === '{') depth++;
            else if (scopeSrc[i] === '}') { depth--; if (depth === 0) break; }
        }
        const after = scopeSrc.slice(i, i + 12).replace(/\s/g, '');
        if (after.startsWith('},' + ms + ')')) return scopeSrc.slice(bodyStart, i);
        from = i + 1;
    }
    throw new Error('No encontrado setInterval de ' + ms + 'ms');
}

const SOURCES = [
    'formatTime', 'getTimerColor', 'updateTimerDisplay', 'tickPlayerTimes',
    'renderField', 'renderBench', 'escapeHtml', 'safeColor', '_timerColorFor',
    'renderMatch',
].map(n => extractFn(html, n)).join('\n\n');

const renderMatchSrc = extractFn(html, 'renderMatch');
const DETAIL_TICK_BODY = extractIntervalBody(renderMatchSrc, 250);
// El intervalo de la lista vive dentro de showLiveNow (función asignada a
// window.showLiveNow). Lo localizamos por su marcador único `.live-list-timer`.
const showLiveStart = html.indexOf("window.showLiveNow");
const showLiveSrc = html.slice(showLiveStart, html.indexOf('window.navigateMatch'));
const LIST_TICK_BODY = extractIntervalBody(showLiveSrc, 1000);

// ── Reloj falso ─────────────────────────────────────────────────────
let NOW = 1_700_000_000_000;
function FakeDate(...a) { return a.length ? new Date(...a) : new Date(NOW); }
FakeDate.now = () => NOW;
FakeDate.prototype = Date.prototype;

// ── DOM mockeado ────────────────────────────────────────────────────
function makeEl(id) {
    return { id, innerHTML: '', textContent: '', style: {}, _attrs: {},
        classList: { toggle(){}, add(){}, remove(){} },
        getAttribute(k){ return this._attrs[k]; },
        setAttribute(k,v){ this._attrs[k]=v; } };
}
function makeDocument() {
    const els = {};
    const listTimers = [];
    return {
        getElementById: (id) => (els[id] ||= makeEl(id)),
        querySelectorAll: (sel) => sel.includes('live-list-timer') ? listTimers : [],
        _els: els, _listTimers: listTimers,
    };
}

function makeSandbox() {
    const sandbox = {
        document: makeDocument(), window: {}, Math, console, JSON,
        Date: FakeDate, parseInt, parseFloat, String, Number,
        timerInterval: null, _liveListUnsubscribe: null,
        setInterval: () => 1, clearInterval: () => {},
    };
    vm.createContext(sandbox);
    vm.runInContext(SOURCES, sandbox);
    return sandbox;
}

let results = [];
function check(name, cond, extra) {
    results.push({ name, ok: !!cond });
    console.log((cond ? 'PASS' : 'FAIL') + ' - ' + name + (extra ? '  ' + extra : ''));
}

function buildSnapshot({ phase='1st_half', mode='f7', isRunning=true, status='active',
                         timeH1=0, timeH2=0, withPhaseStartedAt=true,
                         half1MaxTime=1800, half2MaxTime=1800 }) {
    const baseSecs = phase === '2nd_half' ? timeH2 : timeH1;
    const data = {
        status, mode, phase, isRunning, timeH1, timeH2, half1MaxTime, half2MaxTime,
        updatedAt: { toMillis: () => NOW, toDate: () => new Date(NOW) },
        homeTeam: { name: 'A', score: 0 }, awayTeam: { name: 'B', score: 0 }, players: [],
    };
    if (withPhaseStartedAt) data.phaseStartedAt = NOW - baseSecs * 1000;
    return data;
}

// Simula el FLUJO REAL: cada `snapshotEverySec` segundos llega un snapshot
// (renderMatch) y entre medias el intervalo de 250ms corre. Devuelve el texto
// de #live-timer muestreado UNA VEZ por segundo (al final de cada segundo).
function runDetail(opts, totalSecs, snapshotEverySec = 1) {
    NOW = 1_700_000_000_000;
    const sandbox = makeSandbox();
    const base = { mode: opts.mode, phase: opts.phase, isRunning: opts.isRunning,
                   status: opts.status, half1MaxTime: opts.half1MaxTime,
                   half2MaxTime: opts.half2MaxTime, withPhaseStartedAt: opts.withPhaseStartedAt };
    // Snapshot inicial
    let t1 = (opts.phase === '2nd_half') ? 0 : (opts.timeH1 || 0);
    let t2 = (opts.phase === '2nd_half') ? (opts.timeH2 || 0) : 0;
    sandbox.__data = buildSnapshot({ ...base, timeH1: t1, timeH2: t2 });
    vm.runInContext('renderMatch(__data)', sandbox);
    const timerEl = sandbox.document._els['live-timer'];
    const samples = [timerEl.textContent];

    const tickFn = '(function(){ ' + DETAIL_TICK_BODY + ' })()';
    const elapsedStart = NOW;
    for (let s = 1; s <= totalSecs; s++) {
        // 4 ticks de 250ms en este segundo
        for (let q = 0; q < 4; q++) {
            NOW += 250;
            vm.runInContext(tickFn, sandbox);
        }
        // ¿Llega snapshot al cierre de este segundo? (coach lo emite cada 1s)
        if (opts.isRunning && (s % snapshotEverySec === 0)) {
            const elapsedSec = Math.floor((NOW - elapsedStart) / 1000);
            if (opts.phase === '2nd_half') t2 = (opts.timeH2 || 0) + elapsedSec;
            else t1 = (opts.timeH1 || 0) + elapsedSec;
            sandbox.__data = buildSnapshot({ ...base, timeH1: t1, timeH2: t2 });
            vm.runInContext('renderMatch(__data)', sandbox);
        }
        samples.push(timerEl.textContent);
    }
    return samples;
}

function toSecs(mmss) {
    const neg = mmss.startsWith('+');
    const [m, s] = mmss.replace('+', '').split(':').map(Number);
    return m * 60 + s;
}
// Verifica que la secuencia de cuenta atrás decrece en exactamente 1s por paso.
function decrementsByOne(samples) {
    for (let i = 1; i < samples.length; i++) {
        if (toSecs(samples[i - 1]) - toSecs(samples[i]) !== 1) return false;
    }
    return true;
}

console.log('=== E6: cronómetro live (vista de PARTIDO) ===\n');

// 1) Autónomo F7, snapshots cada 1s (firestore-sync.js real).
{
    const samples = runDetail({ phase:'1st_half', mode:'f7', timeH1:0, isRunning:true, status:'active', half1MaxTime:1800, half2MaxTime:1800, withPhaseStartedAt:true }, 8, 1);
    console.log('1) autónomo F7, snapshot/1s: ' + JSON.stringify(samples));
    check('1. avanza -1s/seg de 30:00 a 29:52', samples[0]==='30:00' && samples[8]==='29:52' && decrementsByOne(samples));
}

// 2) Autónomo F7, SIN snapshots intermedios (coach cerró la app) -> debe seguir.
{
    const samples = runDetail({ phase:'1st_half', mode:'f7', timeH1:0, isRunning:true, status:'active', half1MaxTime:1800, half2MaxTime:1800, withPhaseStartedAt:true }, 8, 999);
    console.log('2) autónomo F7, sin snapshots: ' + JSON.stringify(samples));
    check('2. avanza aunque no lleguen snapshots (autónomo real)', samples[0]==='30:00' && samples[8]==='29:52' && decrementsByOne(samples));
}

// 3) Fallback sin phaseStartedAt (snapshots antiguos), snapshot cada 5s.
{
    const samples = runDetail({ phase:'1st_half', mode:'f7', timeH1:0, isRunning:true, status:'active', half1MaxTime:1800, half2MaxTime:1800, withPhaseStartedAt:false }, 8, 5);
    console.log('3) fallback updatedAt, snapshot/5s: ' + JSON.stringify(samples));
    check('3. avanza -1s/seg en fallback', samples[0]==='30:00' && samples[8]==='29:52' && decrementsByOne(samples));
}

// 4) F11 2ª parte autónomo.
{
    const samples = runDetail({ phase:'2nd_half', mode:'f11', timeH2:0, isRunning:true, status:'active', half1MaxTime:2400, half2MaxTime:2400, withPhaseStartedAt:true }, 6, 1);
    console.log('4) autónomo F11 2ªP: ' + JSON.stringify(samples));
    check('4. F11 2ªP avanza desde 40:00', samples[0]==='40:00' && samples[6]==='39:54' && decrementsByOne(samples));
}

// ── Vista de LISTA (live-list-timer) ───────────────────────────────
console.log('\n=== E6: cronómetro live (vista de LISTA) ===\n');
// buildMatch recibe una función que, dado el NOW base, devuelve el objeto del
// partido (para que phaseStartedAt/updatedAt se anclen al NOW ya reseteado).
function runList(buildMatch, totalSecs) {
    NOW = 1_700_000_000_000;
    const base = NOW;
    const sandbox = makeSandbox();
    const el = makeEl('llt');
    el.setAttribute('data-match', JSON.stringify(buildMatch(base)));
    sandbox.document._listTimers.push(el);
    const tickFn = '(function(){ ' + LIST_TICK_BODY + ' })()';
    const samples = [];
    for (let s = 1; s <= totalSecs; s++) {
        NOW += 1000;
        vm.runInContext(tickFn, sandbox);
        samples.push(el.textContent);
    }
    return samples;
}
{
    const samples = runList((base) => ({ phase:'1st_half', mode:'f7', isRunning:true,
        timeH1:0, timeH2:0, half1MaxTime:1800, half2MaxTime:1800, phaseStartedAt: base }), 6);
    console.log('5) lista autónomo F7: ' + JSON.stringify(samples));
    check('5. lista avanza -1s/seg', decrementsByOne(samples) && samples[0]==='29:59');
}
{
    // Sin phaseStartedAt -> usa updatedAt (epoch ms). data-match congela updatedAt.
    const samples = runList((base) => ({ phase:'1st_half', mode:'f7', isRunning:true,
        timeH1:0, timeH2:0, half1MaxTime:1800, half2MaxTime:1800, updatedAt: base }), 6);
    console.log('6) lista fallback updatedAt: ' + JSON.stringify(samples));
    check('6. lista avanza en fallback', decrementsByOne(samples));
}

console.log('\n' + results.filter(r => r.ok).length + '/' + results.length + ' OK');
const failed = results.filter(r => !r.ok);
if (failed.length) { console.error('FALLOS: ' + failed.map(f => f.name).join(', ')); process.exit(1); }

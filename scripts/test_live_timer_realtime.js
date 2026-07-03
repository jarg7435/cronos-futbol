// E6 — Test en TIEMPO REAL del cronómetro de live.html.
// A diferencia de test_live_timer_tick.js (reloj falso), aquí usamos el reloj y
// el setInterval REALES de Node durante ~3.2s para detectar fallos que un reloj
// mockeado no ve: que el intervalo no se arranque, que lance excepción y muera,
// o que no interpole entre snapshots. Extrae renderMatch real de live.html.
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const html = fs.readFileSync(path.join(__dirname, '..', 'live.html'), 'utf8');
function extractFn(src, name) {
    const start = src.indexOf('function ' + name + '(');
    if (start < 0) throw new Error('No encontrada: ' + name);
    let i = src.indexOf('{', start), depth = 0;
    for (; i < src.length; i++) {
        if (src[i] === '{') depth++;
        else if (src[i] === '}') { depth--; if (depth === 0) { i++; break; } }
    }
    return src.slice(start, i);
}
const SOURCES = ['formatTime','getTimerColor','updateTimerDisplay','tickPlayerTimes',
    'renderField','renderBench','escapeHtml','safeColor','_timerColorFor','renderMatch']
    .map(n => extractFn(html, n)).join('\n\n');

function makeEl(id){ return { id, innerHTML:'', textContent:'', style:{}, _a:{},
    classList:{toggle(){},add(){},remove(){}}, getAttribute(k){return this._a[k];}, setAttribute(k,v){this._a[k]=v;} }; }
const els = {};
const sandbox = {
    document: { getElementById:(id)=>(els[id]||=makeEl(id)), querySelectorAll:()=>[] },
    window:{}, Math, console, JSON, Date, parseInt, parseFloat, String, Number,
    setInterval, clearInterval, timerInterval:null,
};
vm.createContext(sandbox);
vm.runInContext(SOURCES, sandbox);

const NOW = Date.now();
function snapshot(elapsedSec){
    const t = elapsedSec;
    return {
        status:'active', mode:'f7', phase:'1st_half', isRunning:true,
        timeH1:t, timeH2:0, half1MaxTime:1800, half2MaxTime:1800,
        // phaseStartedAt es el instante (constante) de inicio de la parte.
        // En producción el coach lo calcula como Date.now()-masterTime*1000, que
        // se mantiene ≈constante snapshot a snapshot. NO debe recalcularse con el
        // tiempo ya transcurrido o se doblaría el avance.
        phaseStartedAt: NOW,
        updatedAt:{ toMillis:()=>Date.now(), toDate:()=>new Date() },
        homeTeam:{name:'A',score:0}, awayTeam:{name:'B',score:0}, players:[],
    };
}
// Primer snapshot (arranca el intervalo real de 250ms dentro de renderMatch).
sandbox.__data = snapshot(0);
vm.runInContext('renderMatch(__data)', sandbox);

const timerEl = els['live-timer'];
const seen = [];
// Snapshots periódicos cada 1s (como firestore-sync.js).
let sec = 0;
const snapTimer = setInterval(() => {
    sec++;
    sandbox.__data = snapshot(sec);
    vm.runInContext('renderMatch(__data)', sandbox);
}, 1000);
// Muestreo del display cada ~500ms.
const sampler = setInterval(() => { seen.push(timerEl.textContent); }, 500);

setTimeout(() => {
    clearInterval(snapTimer); clearInterval(sampler);
    clearInterval(sandbox.timerInterval);
    console.log('Muestras display (cada ~0.5s, real):', JSON.stringify(seen));
    const distinct = new Set(seen);
    const ok = distinct.size >= 4; // en ~3.2s deben verse >=4 valores distintos
    console.log((ok ? 'PASS' : 'FAIL') + ' - cronómetro avanza en tiempo real (valores distintos=' + distinct.size + ')');
    // Comprobar que decrece (cuenta atrás 30:00 -> ...)
    const toS = (x)=>{const[m,s]=x.replace('+','').split(':').map(Number);return m*60+s;};
    const decreasing = seen.length>1 && toS(seen[0]) > toS(seen[seen.length-1]);
    console.log((decreasing ? 'PASS' : 'FAIL') + ' - el display decrece (cuenta atrás real)');
    process.exit(ok && decreasing ? 0 : 1);
}, 3200);

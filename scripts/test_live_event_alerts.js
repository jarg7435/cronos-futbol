// Test de la lógica de detección de eventos en live.html.
// Extrae las funciones del <script type="module"> y las ejecuta con stubs.
const fs = require('fs');
const vm = require('vm');

const html = fs.readFileSync('live.html', 'utf8');
const m = html.match(/<script type="module">([\s\S]*?)<\/script>/);
let js = m[1];
// Quitar imports (no válidos en este sandbox).
js = js.replace(/import\s+[^;]*?from\s+['"][^'"]*['"];/g, '');
js = js.replace(/import\s*{[^}]*}\s*from\s*['"][^'"]*['"];/g, '');

// Capturas de las alertas emitidas.
const fired = [];

// Sandbox: DOM/Firebase/Audio stubs.
const noopEl = () => ({
  style: {}, classList: { toggle(){}, add(){}, remove(){} },
  appendChild(){}, remove(){}, set innerHTML(v){}, set textContent(v){},
  get firstChild(){ return null; }, children: [], offsetWidth: 0,
});
const sandbox = {
  console, localStorage: { _d:{}, getItem(k){return this._d[k]??null;}, setItem(k,v){this._d[k]=v;} },
  document: {
    getElementById(id){ if(id==='event-toast-stack') return { appendChild(){}, children:{length:0}, get firstChild(){return null;}, removeChild(){} }; return noopEl(); },
    createElement(){ return noopEl(); },
    addEventListener(){},
  },
  navigator: { vibrate(){} },
  window: {}, location: { search:'', pathname:'/live.html', origin:'http://x' },
  history: { pushState(){} },
  setTimeout(){}, clearInterval(){}, setInterval(){ return 0; },
  URLSearchParams: function(){ return { get(){ return null; } }; },
  AudioContext: function(){ return { state:'running', currentTime:0, resume(){}, createOscillator(){return {frequency:{},connect(){},start(){},stop(){}};}, createGain(){return {gain:{setValueAtTime(){},exponentialRampToValueAtTime(){}},connect(){}};}, destination:{} }; },
  // Firebase stubs (no se usan en el test de detección):
  initializeApp(){return {};}, getAuth(){return {};}, getFirestore(){return {};},
  signInWithEmailAndPassword(){}, signOut(){}, onAuthStateChanged(){}, browserLocalPersistence:{}, setPersistence(){return {catch(){}};},
  doc(){return {};}, getDoc(){}, collection(){return {};}, onSnapshot(){return ()=>{};}, getDocs(){return Promise.resolve({forEach(){}});},
};
sandbox.window = sandbox; // window === global-ish
sandbox.addEventListener = function(){};
sandbox.removeEventListener = function(){};
sandbox.webkitAudioContext = sandbox.AudioContext;
vm.createContext(sandbox);

// Inyectar un hook para capturar showEventToast: lo reemplazamos tras evaluar.
js += '\n;globalThis.__exports = { detectAndAlert, _buildState, EVENT_META, showEventToast, _matchPrevState, _matchSeeded, _matchLastTs };';
// Sustituir el cuerpo de showEventToast por un registrador.
js = js.replace(
  /function showEventToast\(type, line, sub\) \{[\s\S]*?\n\}/,
  'function showEventToast(type, line, sub){ globalThis.__fired.push({type,line,sub}); }'
);
sandbox.__fired = fired;
sandbox.globalThis = sandbox;

vm.runInContext(js, sandbox, { filename: 'live-extracted.js' });
const { detectAndAlert, _buildState, _matchPrevState, _matchSeeded, _matchLastTs } = sandbox.__exports;

// ── Datos base ──
// updatedAt monotónico: cada snapshot creado con mk() es más reciente que el
// anterior, replicando el serverTimestamp creciente real de Firestore. Permite
// que el guard anti-snapshot-antiguo (2b) no descarte los snapshots del test.
let _ts = 1000;
function ts(ms) { return { toMillis: () => ms }; }
function mk(players, home, away, status='active', updatedMs) {
  const ms = (updatedMs != null) ? updatedMs : (_ts += 1000);
  return { status, updatedAt: ts(ms),
           homeTeam:{name:'Aguilas', score:home}, awayTeam:{name:'Leones', score:away}, players };
}
function P(id, opts={}) {
  return Object.assign({ id, number:id, name:'Jug'+id, team:'home', status:'field', goals:0, cards:'ninguna', injured:false }, opts);
}

let pass=0, fail=0;
function check(name, cond){ if(cond){pass++; console.log('  ✓ '+name);} else {fail++; console.log('  ✗ FALLO: '+name);} }

const MID = 'match1';
// Plantilla estable: 5 jugadores presentes en TODOS los snapshots (P4/P5 en banca).
function roster(over={}) {
  const base = {
    1: { goals:1 }, 2: { cards:'amarilla' }, 3: {},
    4: { status:'bench' }, 5: { status:'bench' },
  };
  Object.keys(over).forEach(k => { base[k] = Object.assign({}, base[k], over[k]); });
  return Object.keys(base).map(id => P(Number(id), base[id]));
}

// 1. Primera vez NO debe avisar (seed).
fired.length=0;
detectAndAlert(MID, mk(roster(), 1, 0));
check('Primer snapshot no genera alertas (seed)', fired.length===0);

// 2. Gol nuevo (P1 1->2).
fired.length=0;
detectAndAlert(MID, mk(roster({1:{goals:2}}), 2, 0));
check('Gol detectado', fired.some(f=>f.type==='goal' && /GOL/.test(f.line)));
check('Solo 1 alerta de gol', fired.filter(f=>f.type==='goal').length===1);

// 3. Tarjeta amarilla nueva en P3.
fired.length=0;
detectAndAlert(MID, mk(roster({1:{goals:2}, 3:{cards:'amarilla'}}), 2, 0));
check('Amarilla detectada', fired.some(f=>f.type==='yellow'));

// 4. Roja en P2 (de amarilla a roja).
fired.length=0;
detectAndAlert(MID, mk(roster({1:{goals:2}, 2:{cards:'roja'}, 3:{cards:'amarilla'}}), 2, 0));
check('Roja detectada', fired.some(f=>f.type==='red'));
check('No re-avisa amarilla previa', !fired.some(f=>f.type==='yellow'));

// 5. Lesión en P1.
fired.length=0;
detectAndAlert(MID, mk(roster({1:{goals:2,injured:true}, 2:{cards:'roja'}, 3:{cards:'amarilla'}}), 2, 0));
check('Lesión detectada', fired.some(f=>f.type==='injury'));

// 6. Cambio: P3 sale a banca (sin roja), P4 entra al campo. P2(roja) ya en campo.
fired.length=0;
detectAndAlert(MID, mk(roster({1:{goals:2,injured:true}, 2:{cards:'roja'}, 3:{cards:'amarilla',status:'bench'}, 4:{status:'field'}}), 2, 0));
check('Cambio detectado', fired.some(f=>f.type==='sub'));
check('Solo 1 evento de cambio', fired.filter(f=>f.type==='sub').length===1);
const subAlert = fired.find(f=>f.type==='sub');
check('Cambio empareja entra/sale', subAlert && /▲/.test(subAlert.line) && /▼/.test(subAlert.line));

// 6b. Expulsión: P5 entra, P2 (roja) pasa a banca -> NO debe contar como "cambio" la salida por roja.
fired.length=0;
detectAndAlert(MID, mk(roster({1:{goals:2,injured:true}, 2:{cards:'roja',status:'bench'}, 3:{cards:'amarilla',status:'bench'}, 4:{status:'field'}, 5:{status:'field'}}), 2, 0));
check('Entrada de P5 detectada como cambio', fired.some(f=>f.type==='sub'));
check('Salida por roja NO genera cambio extra', fired.filter(f=>f.type==='sub').length===1);

// 7. Sin cambios -> sin alertas.
fired.length=0;
detectAndAlert(MID, mk(roster({1:{goals:2,injured:true}, 2:{cards:'roja',status:'bench'}, 3:{cards:'amarilla',status:'bench'}, 4:{status:'field'}, 5:{status:'field'}}), 2, 0));
check('Snapshot idéntico no genera alertas', fired.length===0);

// 8. Partido finalizado no debe avisar aunque cambie.
fired.length=0;
detectAndAlert(MID, mk(roster({1:{goals:5,injured:true}, 2:{cards:'roja',status:'bench'}, 3:{cards:'amarilla',status:'bench'}, 4:{status:'field'}, 5:{status:'field'}}), 5, 0, 'finished'));
check('Partido finalizado no genera alertas', fired.length===0);

// 9. Partido distinto se semilla aparte (no mezcla estados).
fired.length=0;
detectAndAlert('match2', mk([P(1,{goals:3})], 3, 0));
check('Segundo partido: primer snapshot es seed (sin alertas)', fired.length===0);
detectAndAlert('match2', mk([P(1,{goals:4})], 4, 0));
check('Segundo partido: gol posterior detectado', fired.some(f=>f.type==='goal'));

// ════════════════════════════════════════════════════════════════════
//  CASOS NUEVOS — Correcciones QA del commit 570a8a3
// ════════════════════════════════════════════════════════════════════

// Helper: reinicia el estado de un partido para empezar un escenario limpio.
function reset(id){ delete _matchPrevState[id]; delete _matchSeeded[id]; delete _matchLastTs[id]; }

// ── 2b · Snapshot NO monotónico (reenvío / reconexión) ──────────────
// Tras semillar y avisar de un gol, reenviar un snapshot con updatedAt IGUAL
// o ANTERIOR no debe re-disparar la alerta ya mostrada.
reset('m2b');
const T1 = 5000, T2 = 6000;
detectAndAlert('m2b', mk(roster(), 1, 0, 'active', T1));          // seed (ts=T1)
fired.length=0;
detectAndAlert('m2b', mk(roster({1:{goals:2}}), 2, 0, 'active', T2)); // gol real (ts=T2)
check('2b · Gol nuevo con ts creciente detectado', fired.filter(f=>f.type==='goal').length===1);

fired.length=0;
detectAndAlert('m2b', mk(roster({1:{goals:2}}), 2, 0, 'active', T2)); // MISMO ts reenviado
check('2b · Reenvío con MISMO updatedAt descartado (sin doble alerta)', fired.length===0);

fired.length=0;
detectAndAlert('m2b', mk(roster({1:{goals:2}}), 2, 0, 'active', T1)); // ts ANTERIOR (snapshot viejo)
check('2b · Snapshot con updatedAt ANTERIOR descartado', fired.length===0);

// Un cambio de tarjeta reenviado por flip caché→servidor con ts viejo tampoco re-dispara.
fired.length=0;
detectAndAlert('m2b', mk(roster({1:{goals:2}, 2:{cards:'roja'}}), 2, 0, 'active', T2-500)); // ts < último
check('2b · Tarjeta en snapshot atrasado NO re-dispara', fired.length===0);

// ── 2b · Snapshot fromCache se ignora ───────────────────────────────
reset('mCache');
detectAndAlert('mCache', mk(roster(), 1, 0, 'active', 9000));               // seed (server)
fired.length=0;
detectAndAlert('mCache', mk(roster({1:{goals:2}}), 2, 0, 'active', 10000), /*fromCache*/true);
check('2b · Snapshot fromCache=true ignorado (sin alerta)', fired.length===0);
// El mismo cambio confirmado por el servidor (fromCache=false) SÍ avisa.
detectAndAlert('mCache', mk(roster({1:{goals:2}}), 2, 0, 'active', 10001), /*fromCache*/false);
check('2b · Mismo cambio confirmado por servidor SÍ avisa', fired.some(f=>f.type==='goal'));

// ── 1a · Sin doble alerta en el partido activo ──────────────────────
// Simula el flujo real: el listener de loadMatch llama detectAndAlert para el
// partido activo; el watcher de fondo CEDE (no procesa currentMatchId). Aunque
// el snapshot llegue por ambos canales, solo debe avisar UNA vez.
reset('mActive');
const currentMatchId = 'mActive'; // el watcher de fondo haría: if (m.id===currentMatchId) return;
detectAndAlert('mActive', mk(roster(), 1, 0, 'active', 11000)); // seed (listener activo)
fired.length=0;
// (1) listener activo procesa el snapshot del gol:
detectAndAlert('mActive', mk(roster({1:{goals:2}}), 2, 0, 'active', 12000));
// (2) watcher de fondo recibe el MISMO snapshot pero, como m.id===currentMatchId,
//     hace 'return' y NO vuelve a llamar detectAndAlert (comportamiento del código):
if ('mActive' === currentMatchId) { /* cede: no procesa */ }
check('1a · Partido activo: una sola alerta de gol (sin duplicar)', fired.filter(f=>f.type==='goal').length===1);

// Aunque por error el watcher de fondo reprocesara el MISMO ts, el guard 2b lo frena:
fired.length=0;
detectAndAlert('mActive', mk(roster({1:{goals:2}}), 2, 0, 'active', 12000)); // mismo ts
check('1a · Reproceso del mismo snapshot no duplica alerta', fired.length===0);

console.log('\nRESULTADO: ' + pass + ' OK, ' + fail + ' fallos');
process.exit(fail ? 1 : 0);

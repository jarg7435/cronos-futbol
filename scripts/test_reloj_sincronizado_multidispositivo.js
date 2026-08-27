// ─────────────────────────────────────────────────────────────────────────
// test_reloj_sincronizado_multidispositivo.js  ·  v638
//
// Pruebas de campo del autor (implementar.txt 2026-08-27, punto 2), con el
// MISMO partido abierto en el PC y en dos tablets:
//   · F7 Alevín C  — "pausar y reanudar no responde en la tablet".
//   · F11 Juvenil  — "tras pausar, ~1 minuto de desfase entre PC y tablet".
//
// Dos síntomas, TRES defectos, todos en js/match/timer/core.js:
//
//  🔴 1 · UNIDADES. `_maxDriftAllowed = 1500` con el comentario "> 1.5s": está
//     en MILISEGUNDOS, pero lo que compara son SEGUNDOS (`masterTimeH1 +=
//     clampedDeltaSec`, y `timeH1: masterTimeH1` en live/sync.js). El umbral
//     real eran 1500 s = 25 MINUTOS: la corrección de desfase NO HA
//     FUNCIONADO NUNCA. El minuto medido cae muy por debajo.
//
//  🔴 2 · SÓLO SINCRONIZABA EN MARCHA. La llamada vivía dentro de `tick()`, y
//     `tick` sólo corre con el reloj en marcha. Él dice "TRAS PAUSAR": el
//     momento exacto en que el mecanismo se apagaba.
//
//  🔴 3 · NO SE MIRABA `isRunning`. El snapshot lo lleva desde siempre, pero
//     nadie lo leía: cada aparato decidía por su cuenta si el reloj corre.
//
// ⚠️ ESTE GUARD MIDE EJECUTANDO, no por la forma del código. La aserción 1a es
//    la excepción y va con motivo: un umbral es un NÚMERO, y el defecto era
//    justo el número.
// ─────────────────────────────────────────────────────────────────────────
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.join(__dirname, '..');
const SRC = fs.readFileSync(path.join(ROOT, 'js', 'match', 'timer', 'core.js'), 'utf8');

let fail = 0, pass = 0;
const ok = (name, cond, extra) => {
    if (cond) { pass++; console.log('PASS ' + name); }
    else { fail++; console.log('FAIL ' + name); if (extra !== undefined) console.log('       ' + JSON.stringify(extra)); }
};

console.log('── El reloj, sincronizado entre dispositivos (v638) ──\n');

function extractFn(name) {
    const start = SRC.search(new RegExp('(?:async )?function ' + name + '\\('));
    if (start === -1) throw new Error('No se encontró ' + name);
    let depth = 0, started = false, end = start;
    for (let i = start; i < SRC.length; i++) {
        if (SRC[i] === '{') { depth++; started = true; }
        if (SRC[i] === '}') { depth--; if (started && depth === 0) { end = i; break; } }
    }
    return SRC.slice(start, end + 1);
}

// ═══════════════ PARTE 1 · el umbral, que era el defecto ═══════════════
console.log('── PARTE 1 · el umbral ──');
{
    const m = SRC.match(/let _maxDriftAllowed = (\d+)/);
    const valor = m ? Number(m[1]) : null;
    ok('1a · 🔑🔑 el umbral de desfase está en SEGUNDOS, no en milisegundos',
       valor !== null && valor > 0 && valor <= 5,
       { valor, porque: 'compara segundos contra segundos; 1500 exigía 25 minutos de desfase' });
}

// ═══════════════ PARTE 2 · ejecución real ═══════════════
console.log('\n── PARTE 2 · ejecución del código real ──');

function montar({ servidor, local }) {
    const intervalos = [];
    const sandbox = {
        console: { log() {}, warn() {} },
        Math, Date, Promise, Number, Boolean,
        // Estado LOCAL del aparato
        isRunning:    local.isRunning,
        masterTimeH1: local.timeH1,
        masterTimeH2: local.timeH2,
        matchPhase:   local.phase,
        lastTickTime: 0,
        timerInterval: null,
        liveMatchId:  'partido1',
        liveIsActive: true,
        updateMasterUI: () => {},
        setInterval: (fn, ms) => { intervalos.push(ms); return intervalos.length; },
        clearInterval: () => {},
        botones: { 'btn-play-pause': { textContent: local.isRunning ? 'PAUSAR' : 'REANUDAR',
                                       classList: { add() {}, remove() {} } } },
    };
    sandbox.document = { getElementById: (id) => sandbox.botones[id] || null };
    sandbox.window = {
        _cronos_auth: { db: {} },
        _CRONOS_DEBUG: false,
        renderOptimizer: null,
    };
    // El módulo pide Firestore con `import()` dinámico → se sustituye por __imp,
    // como en el resto de arneses del proyecto.
    sandbox.__imp = async () => ({
        doc: (db, col, id) => ({ col, id }),
        getDoc: async () => ({ exists: () => true, data: () => servidor }),
    });
    vm.createContext(sandbox);
    const codigo = [
        'let _lastServerSync = 0;',
        'const _SERVER_SYNC_INTERVAL_MS = 5000;',
        SRC.match(/let _maxDriftAllowed = \d+;/)[0],
        'let _vigiaReloj = null;',
        extractFn('_arrancarVigiaReloj'),
        extractFn('_adoptarMarchaDelServidor'),
        extractFn('syncTimerWithServer'),
        'this.__sync = syncTimerWithServer; this.__vigia = _arrancarVigiaReloj;',
    ].join('\n').replace(/\bimport\s*\(/g, '__imp(');
    vm.runInContext(codigo, sandbox, { filename: 'timer-core.js' });
    return { sandbox, intervalos };
}

async function run() {
    // 2a-2b · EL CASO F11: el PC va 60 s por delante y la tablet no se entera.
    {
        const { sandbox } = montar({
            servidor: { isRunning: true, timeH1: 660, timeH2: 0 },
            local:    { isRunning: true, timeH1: 600, timeH2: 0, phase: '1st_half' },
        });
        await sandbox.__sync();
        ok('2a · 🔑🔑 un minuto de desfase SÍ se corrige (antes hacían falta 25)',
           sandbox.masterTimeH1 === 660,
           { local: sandbox.masterTimeH1, servidor: 660 });
    }
    {
        // …y una diferencia de un segundo NO se toca: es el propio latido.
        const { sandbox } = montar({
            servidor: { isRunning: true, timeH1: 601, timeH2: 0 },
            local:    { isRunning: true, timeH1: 600, timeH2: 0, phase: '1st_half' },
        });
        await sandbox.__sync();
        ok('2b · ⚠️ pero un segundo de diferencia no se corrige (sería temblor)',
           sandbox.masterTimeH1 === 600, { local: sandbox.masterTimeH1 });
    }

    // 2c-2e · EL CASO F7: "pausar no responde en la tablet".
    {
        const { sandbox } = montar({
            servidor: { isRunning: false, timeH1: 300, timeH2: 0 },   // el PC pausó
            local:    { isRunning: true,  timeH1: 300, timeH2: 0, phase: '1st_half' },
        });
        await sandbox.__sync();
        ok('2c · 🔑🔑 si el servidor está EN PAUSA, este aparato para también',
           sandbox.isRunning === false);
        ok('2d · y el botón pasa a decir REANUDAR',
           sandbox.botones['btn-play-pause'].textContent === 'REANUDAR');
    }
    {
        const { sandbox } = montar({
            servidor: { isRunning: true,  timeH1: 300, timeH2: 0 },   // el PC reanudó
            local:    { isRunning: false, timeH1: 300, timeH2: 0, phase: '1st_half' },
        });
        await sandbox.__sync();
        ok('2e · 🔑 y si el servidor REANUDA, este aparato arranca',
           sandbox.isRunning === true &&
           sandbox.botones['btn-play-pause'].textContent === 'PAUSAR');
        ok('2f · ⚠️ al adoptar la marcha se resetea lastTickTime',
           sandbox.lastTickTime > 0,
           'sin esto el primer tick sumaría de golpe todo el hueco de la pausa');
    }
    {
        // Y si ya coinciden, no se toca nada (ni botón ni intervalos).
        const { sandbox, intervalos } = montar({
            servidor: { isRunning: true, timeH1: 300, timeH2: 0 },
            local:    { isRunning: true, timeH1: 300, timeH2: 0, phase: '1st_half' },
        });
        await sandbox.__sync();
        ok('2g · si ya van igual, no se reprograma el reloj',
           sandbox.isRunning === true && intervalos.length === 0, { intervalos });
    }

    // 2h · la fase importa: un desfase de H2 no toca H1.
    {
        const { sandbox } = montar({
            servidor: { isRunning: true, timeH1: 900, timeH2: 660 },
            local:    { isRunning: true, timeH1: 600, timeH2: 600, phase: '2nd_half' },
        });
        await sandbox.__sync();
        ok('2h · en la 2ª parte se corrige H2 y NO se pisa H1',
           sandbox.masterTimeH2 === 660 && sandbox.masterTimeH1 === 600,
           { h1: sandbox.masterTimeH1, h2: sandbox.masterTimeH2 });
    }

    // ═══════════ PARTE 3 · el vigía sigue en pie EN PAUSA ═══════════
    console.log('\n── PARTE 3 · con el reloj parado también se sincroniza ──');
    {
        const { sandbox, intervalos } = montar({
            servidor: { isRunning: false, timeH1: 300, timeH2: 0 },
            local:    { isRunning: false, timeH1: 300, timeH2: 0, phase: '1st_half' },
        });
        sandbox.__vigia();
        ok('3a · 🔑🔑 el vigía se arma aunque el reloj esté PARADO',
           intervalos.includes(5000),
           { intervalos, porque: 'el desfase aparecía justo tras pausar, que es cuando tick() deja de correr' });
    }
    {
        // …y no se duplica si se pide dos veces (dar a pausa/reanuda varias veces).
        const { sandbox, intervalos } = montar({
            servidor: { isRunning: true, timeH1: 300, timeH2: 0 },
            local:    { isRunning: true, timeH1: 300, timeH2: 0, phase: '1st_half' },
        });
        sandbox.__vigia(); sandbox.__vigia(); sandbox.__vigia();
        ok('3b · ⚠️ y NO se duplica al pedirlo varias veces',
           intervalos.filter(m => m === 5000).length === 1, { intervalos });
    }

    // 3c · `toggleGame` lo arma en LAS DOS direcciones, no sólo al reanudar.
    {
        const cuerpo = extractFn('toggleGame');
        const ramaPausa = cuerpo.slice(cuerpo.indexOf('} else {'));
        ok('3c · toggleGame arma el vigía fuera del if/else (pausa Y reanudación)',
           /_arrancarVigiaReloj\(\)/.test(cuerpo) && !/_arrancarVigiaReloj\(\)/.test(ramaPausa.slice(0, ramaPausa.indexOf('}'))),
           'si sólo se armara al reanudar, pausar volvería a dejar el aparato sordo');
    }
}

run().then(() => {
    console.log('\n' + pass + ' PASS / ' + fail + ' FAIL');
    process.exit(fail ? 1 : 0);
}).catch(e => { console.error('ERROR ejecutando el test:', e); process.exit(1); });

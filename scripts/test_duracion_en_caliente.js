// ════════════════════════════════════════════════════════════════════════
//  test_duracion_en_caliente.js
//  CAMBIAR LA DURACIÓN CON EL PARTIDO EN MARCHA — v587
// ════════════════════════════════════════════════════════════════════════
//  Reporte del autor (partido real de Regional FEM A sobre v586): arrancó con
//  45 minutos por parte y, a mitad de la primera, los cambió a 5. En ese
//  instante **el visor en vivo se desvinculó del directo**: su reloj se
//  congeló mientras el panel del entrenador seguía sumando los 42-43 minutos
//  reales. Al pulsar "Reiniciar" los 5 minutos aparecieron "de golpe".
//
//  🔑🔑🔑 `editTimer` cambiaba una variable local y repintaba. NADA MÁS: ni
//  guardaba el estado, ni empujaba un snapshot. El visor seguía con la
//  duración vieja hasta que otra cosa cualquiera provocara un envío — de ahí
//  el "de golpe" al tocar otro botón. No era el cronómetro: era que nadie se
//  lo contaba al visor.
//
//  🔑 Y HAY UNA PARTE QUE NO ES UN FALLO, SINO UNA DECISIÓN: si ya se jugaron
//  42 minutos y la parte pasa a durar 5, esa parte está terminada — el tiempo
//  transcurrido es un hecho. Sólo el entrenador sabe si quiere darla por
//  acabada o volver a contar desde cero, así que ahora se le pregunta. Antes
//  no ocurría ninguna de las dos cosas: se quedaba a medias.
// ════════════════════════════════════════════════════════════════════════
'use strict';

const fs   = require('fs');
const path = require('path');
const vm   = require('vm');

const ROOT = path.join(__dirname, '..');
let fallos = 0, total = 0;
function ok(nombre, cond, detalle) {
    total++;
    if (cond) console.log('  ✓ ' + nombre);
    else { fallos++; console.log('  ✗ ' + nombre + (detalle !== undefined ? '  → ' + JSON.stringify(detalle) : '')); }
}

const CORE = fs.readFileSync(path.join(ROOT, 'js/match/timer/core.js'), 'utf8');
const SYNC = fs.readFileSync(path.join(ROOT, 'js/match/live/sync.js'), 'utf8');

// ── Se aísla y ejecuta la función REAL, no una copia ───────────────────
function bloqueEditTimer() {
    const i = CORE.indexOf('function editTimer(half) {');
    if (i < 0) throw new Error('No se encuentra editTimer');
    let prof = 0, j = i;
    for (; j < CORE.length; j++) {
        if (CORE[j] === '{') prof++;
        else if (CORE[j] === '}') { prof--; if (prof === 0) { j++; break; } }
    }
    return CORE.slice(i, j);
}
const BLOQUE = bloqueEditTimer();

function correr({ half = 1, respuesta = '5', confirma = true,
                  matchPhase = '1st_half', masterTimeH1 = 2520, masterTimeH2 = 0,
                  half1MaxTime = 2700, half2MaxTime = 2700,
                  liveIsActive = true } = {}) {
    const efectos = { guardados: 0, empujados: [], toasts: [], prompts: [], confirms: [], pintados: 0 };
    const sb = {
        half, matchPhase, masterTimeH1, masterTimeH2, half1MaxTime, half2MaxTime,
        liveIsActive, lastTickTime: 1000,
        parseInt, isNaN, String, Math, Date, Number,
        console: { log() {}, warn() {} },
        prompt: (txt, def) => { efectos.prompts.push(txt); return respuesta; },
        confirm: (txt) => { efectos.confirms.push(txt); return confirma; },
        updateMasterUI: () => { efectos.pintados++; },
        showToast: (m) => efectos.toasts.push(String(m)),
        pushLiveSnapshot: async (estado) => { efectos.empujados.push(estado); },
        window: { _saveMatchStateToStorage: () => { efectos.guardados++; } },
    };
    vm.createContext(sb);
    vm.runInContext(BLOQUE + '\neditTimer(half);', sb);
    return { e: efectos, sb };
}

console.log('\n── 1 · el defecto reportado: el visor no se enteraba ──');
{
    // El caso del autor: 42 min jugados, se ponen 5. Elige CONSERVAR lo jugado.
    const { e, sb } = correr({ respuesta: '5', confirma: false });
    ok('1a · 🔑🔑🔑 se EMPUJA un snapshot al visor en el acto',
       e.empujados.length === 1 && e.empujados[0] === 'active', e.empujados);
    ok('1b · 🔑 y se guarda el estado (antes tampoco: una recarga lo perdía)',
       e.guardados === 1, e.guardados);
    ok('1c · la duración nueva queda aplicada', sb.half1MaxTime === 300, sb.half1MaxTime);
    ok('1d · y se repinta el panel', e.pintados === 1);
    ok('1e · se le dice al entrenador que el visor está sincronizado',
       /sincronizado/i.test(e.toasts.join(' ')), e.toasts);
}
{
    // El mismo caso, pero eligiendo RECONTAR desde cero.
    const { e, sb } = correr({ respuesta: '5', confirma: true });
    ok('1f · 🔑🔑🔑 al aceptar, el cronómetro vuelve a CERO', sb.masterTimeH1 === 0, sb.masterTimeH1);
    ok('1g · ⚠️ y se re-ancla `lastTickTime`, de donde el visor deriva su reloj',
       sb.lastTickTime > 1000, sb.lastTickTime);
    ok('1h · el snapshot sale igualmente', e.empujados.length === 1);
    ok('1i · y el aviso lo dice', /reiniciad/i.test(e.toasts.join(' ')), e.toasts);
}

console.log('\n── 2 · se PREGUNTA sólo cuando hay que preguntar ──');
{
    const { e } = correr({ respuesta: '5', masterTimeH1: 2520 });
    ok('2a · 🔑 con más jugado que la duración nueva, se pregunta',
       e.confirms.length === 1, e.confirms.length);
    ok('2b · y la pregunta dice cuánto se lleva jugado y qué hace cada opción',
       /42:00/.test(e.confirms[0]) && /ACEPTAR/.test(e.confirms[0]) && /CANCELAR/.test(e.confirms[0]),
       e.confirms[0]);
}
{
    // Caso normal: 2 minutos jugados y se corrige de 45 a 25. Nada que decidir.
    const { e, sb } = correr({ respuesta: '25', masterTimeH1: 120 });
    ok('2c · ⚠️ si aún cabe, NO se molesta al entrenador con preguntas',
       e.confirms.length === 0, e.confirms.length);
    ok('2d · la duración se aplica y no se toca lo jugado',
       sb.half1MaxTime === 1500 && sb.masterTimeH1 === 120, [sb.half1MaxTime, sb.masterTimeH1]);
    ok('2e · y aun así se sincroniza (era el defecto de fondo)',
       e.empujados.length === 1 && e.guardados === 1);
}
{
    // Alargar la parte tampoco plantea ninguna duda.
    const { e, sb } = correr({ respuesta: '60', masterTimeH1: 2520 });
    ok('2f · alargar la duración no pregunta nada',
       e.confirms.length === 0 && sb.half1MaxTime === 3600);
}
{
    // Editar la 1ª parte cuando ya se juega la 2ª: esa parte no está en curso.
    const { e } = correr({ half: 1, matchPhase: '2nd_half', respuesta: '5', masterTimeH1: 2520 });
    ok('2g · ⚠️ una parte que ya NO está en curso no dispara la pregunta',
       e.confirms.length === 0, e.confirms.length);
}
{
    // La 2ª parte en curso sí, y sobre su propio contador.
    const { e, sb } = correr({ half: 2, matchPhase: '2nd_half', respuesta: '5',
                               masterTimeH2: 1800, confirma: true });
    ok('2h · 🔑 la 2ª parte usa SU contador, no el de la primera',
       e.confirms.length === 1 && sb.masterTimeH2 === 0 && sb.half2MaxTime === 300,
       [sb.masterTimeH2, sb.half2MaxTime]);
}

console.log('\n── 3 · lo que no puede romperse ──');
{
    const { e, sb } = correr({ respuesta: null });
    ok('3a · cancelar el diálogo no cambia NADA y no sincroniza',
       sb.half1MaxTime === 2700 && e.empujados.length === 0 && e.guardados === 0 && e.pintados === 0);
}
{
    const { e, sb } = correr({ respuesta: 'ocho' });
    ok('3b · un valor no numérico se rechaza y se dice',
       sb.half1MaxTime === 2700 && e.empujados.length === 0 &&
       /no v[áa]lida/i.test(e.toasts.join(' ')), e.toasts);
}
{
    const { e, sb } = correr({ respuesta: '0' });
    ok('3c · cero minutos se rechaza', sb.half1MaxTime === 2700 && e.empujados.length === 0);
}
{
    const { e, sb } = correr({ respuesta: '-5' });
    ok('3d · y un negativo también', sb.half1MaxTime === 2700 && e.empujados.length === 0);
}
{
    // Sin emisión en vivo no hay a quién empujar, pero SÍ hay que guardar.
    const { e, sb } = correr({ respuesta: '25', masterTimeH1: 120, liveIsActive: false });
    ok('3e · ⚠️ sin partido en vivo no se empuja nada…', e.empujados.length === 0);
    ok('3f · …pero el estado se guarda igual (si no, la recarga lo pierde)',
       e.guardados === 1 && sb.half1MaxTime === 1500);
}

console.log('\n── 4 · el visor recibe de verdad la duración nueva ──');
{
    // 🔑 Empujar no sirve de nada si el snapshot no LLEVA las duraciones.
    ok('4a · 🔑 el snapshot incluye half1MaxTime y half2MaxTime',
       /half1MaxTime:\s*\(typeof half1MaxTime/.test(SYNC) &&
       /half2MaxTime:\s*\(typeof half2MaxTime/.test(SYNC));
    ok('4b · y `phaseStartedAt` se DERIVA de masterTimeH1/H2',
       /phaseStartedAt:[\s\S]{0,320}masterTimeH2 : masterTimeH1/.test(SYNC),
       'si no se derivara, reiniciar el contador no re-anclaría el visor');
    ok('4c · 🔑 el snapshot se empuja con el mismo estado que el resto del reloj',
       /pushLiveSnapshot\('active'\)/.test(CORE));
}

console.log('\n' + '─'.repeat(70));
console.log('Resultado: ' + (total - fallos) + '/' + total);
if (fallos === 0) console.log('✅ La duración se puede corregir en caliente, y el visor se entera');
else console.log('❌ ' + fallos + ' aserción(es) en rojo');
process.exit(fallos === 0 ? 0 : 1);

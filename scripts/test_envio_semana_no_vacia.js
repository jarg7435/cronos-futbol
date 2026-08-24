// test_envio_semana_no_vacia.js
// ════════════════════════════════════════════════════════════════════
//  🔴 «La semana está vacía» CON LA SEMANA PUESTA (v621)
// ════════════════════════════════════════════════════════════════════
//  Reporte del autor (implementar.txt, 2026-08-24): al enviar la planificación
//  semanal a Dirección/Coordinación saltaba «⚠️ La semana está vacía: rellena
//  algún día antes de enviar» con la semana rellena Y guardada. El envío
//  quedaba completamente bloqueado.
//
//  🔑🔑 LA CAUSA: `training-notify.js` leía `cronos_training_weeks` A PELO y
//  esperaba los días colgando de la raíz de la semana. Desde **v518** cuelgan
//  de `teams.<teamId>` —el cuadrante era POR CLUB y dos entrenadores se
//  pisaban—, así que `semana[fecha]` devolvía SIEMPRE vacío. El fichero no se
//  tocaba desde v510: llevaba roto desde aquel cambio, sin que nadie lo notara
//  porque el síntoma acusa al usuario ("rellena algún día") en vez de al código.
//
//  🔑 ESTE GUARD CARGA LOS DOS MÓDULOS REALES —el lector único y el que envía—
//  y les da un localStorage con la forma de v518. Un doble de `readWeekDays`
//  habría probado mi stub, no que los dos ficheros se entienden.
// ════════════════════════════════════════════════════════════════════

const fs = require('fs');
const path = require('path');
const vm = require('vm');

let n = 0, ok_ = 0, mal = 0;
function ok(nombre, cond, detalle) {
    n++;
    if (cond) { ok_++; console.log('  PASS  ' + nombre); }
    else { mal++; console.error('  FAIL  ' + nombre + (detalle ? ' -> ' + detalle : '')); }
}

const RAIZ = path.join(__dirname, '..');
const P_NOTIFY = process.env.CRONOS_TRAINING_NOTIFY ||
                 path.join(RAIZ, 'js/coach/comms/training-notify.js');
const SRC_SYNC   = fs.readFileSync(path.join(RAIZ, 'js/services/training-firestore-sync.js'), 'utf8');
const SRC_NOTIFY = fs.readFileSync(P_NOTIFY, 'utf8');
const SRC_PARENT = fs.readFileSync(path.join(RAIZ, 'js/parent/panel.js'), 'utf8');

const sinCom = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

const SEMANA = '2026-08-24';
const TEAM   = 'CLUB__juvenil__a';
const DIAS   = {
    '2026-08-24': { tipo: 'Entrenamiento', hora: '20:00', lugar: 'CM CR ARINAGA', duracion: '90 MIN' },
    '2026-08-25': { tipo: 'Entrenamiento', hora: '20:00', lugar: 'CM CR ARINAGA', duracion: '90 MIN' },
    '2026-08-28': { tipo: 'Partido amistoso', hora: '20:00', lugar: 'CM CR ARINAGA', duracion: '90 MIN' }
};

// Monta un sandbox con los DOS módulos reales y el almacén que se le indique.
function arranca(almacen) {
    const ls = { cronos_training_weeks: JSON.stringify(almacen) };
    const sb = {
        console: { log() {}, warn() {}, error() {} },
        Date, Math, JSON, String, Number, Object, Array, RegExp, Promise, Map, Set,
        parseInt, parseFloat, isNaN, isFinite, setTimeout, Intl,
        localStorage: {
            getItem: (k) => (k in ls ? ls[k] : null),
            setItem: (k, v) => { ls[k] = String(v); },
            removeItem: (k) => { delete ls[k]; }
        },
        document: { getElementById: () => null, querySelectorAll: () => [] },
        navigator: {}, addEventListener() {}, removeEventListener() {}
    };
    sb.window = sb;
    vm.createContext(sb);
    // 1. El lector único, de verdad.
    vm.runInContext(SRC_SYNC, sb);
    // El equipo del entrenador: es lo que decide QUÉ rama de `teams` se lee.
    sb.cronosMyTeamId = () => TEAM;
    // 2. Sólo la función que se quiere medir: el fichero entero arrastra
    //    dependencias de la modal que aquí no pintan nada.
    const fn = (SRC_NOTIFY.match(/function _trDiasDeLaSemana\(weekKey\)[\s\S]*?\n\}/) || [''])[0];
    vm.runInContext(fn, sb);
    return sb;
}

console.log('=== TEST: la semana llena NO puede dar «semana vacía» ===\n');

// ── PARTE 1 · el escenario del autor ────────────────────────────────
console.log('PARTE 1 · la semana guardada como la guarda v518');
const nuevo = arranca({ [SEMANA]: { teams: { [TEAM]: DIAS }, createdBy: 'u1', lastModified: 'x' } });
ok('1a · la función existe en el fichero de envío', typeof nuevo._trDiasDeLaSemana === 'function');

const leidos = nuevo._trDiasDeLaSemana(SEMANA);
// ⚠️ Se comprueba que las claves sean LAS FECHAS, no que haya tres. Con la
//    lectura rota salían también tres —`teams`, `createdBy`, `lastModified`—
//    y esta aserción pasaba por casualidad: lo cazó el red-check.
ok('1b · 🔴 LEE LOS DÍAS (antes devolvía los metadatos y bloqueaba el envío)',
   JSON.stringify(Object.keys(leidos).sort()) ===
   JSON.stringify(['2026-08-24', '2026-08-25', '2026-08-28']),
   JSON.stringify(Object.keys(leidos)));
ok('1c · y son los de verdad, con su hora y su lugar',
   leidos['2026-08-24'] && leidos['2026-08-24'].hora === '20:00' &&
   leidos['2026-08-24'].lugar === 'CM CR ARINAGA', JSON.stringify(leidos['2026-08-24']));

// 🔑 La validación del envío es `days.some(d => d.time || d.note || d.venue)`.
//    Se reproduce el mapeo para comprobar el veredicto, que es lo que él vio.
function hayAlgoQueEnviar(dias) {
    const out = [];
    for (let i = 0; i < 7; i++) {
        const f = new Date(new Date(SEMANA + 'T12:00:00').getTime() + i * 86400000);
        const clave = f.getFullYear() + '-' + String(f.getMonth() + 1).padStart(2, '0') +
                      '-' + String(f.getDate()).padStart(2, '0');
        const dd = dias[clave] || {};
        out.push({ time: dd.hora || '', venue: dd.lugar || '',
                   note: [dd.tipo, dd.equipaciones, dd.duracion].filter(Boolean).join(' · ') });
    }
    return out.some(d => d.time || d.note || d.venue);
}
ok('1d · 🔴🔴 el envío YA NO se bloquea', hayAlgoQueEnviar(leidos) === true,
   'esto es exactamente lo que le salía en pantalla');

// ── PARTE 2 · sin romper lo viejo ───────────────────────────────────
console.log('\nPARTE 2 · el formato anterior a v518 sigue leyéndose');
const viejo = arranca({ [SEMANA]: Object.assign({ createdBy: 'u1' }, DIAS) });
const leidosV = viejo._trDiasDeLaSemana(SEMANA);
ok('2a · una semana en el formato legado se lee igual', Object.keys(leidosV).length === 3);
// ⚠️ Sin el filtro por formato de fecha, `createdBy` viajaba como si fuera un
//    día y el mensaje salía con «📅 undefined Invalid Date» (v518).
ok('2b · ⚠️ y los metadatos NO se cuelan como si fueran días',
   !('createdBy' in leidosV), JSON.stringify(Object.keys(leidosV)));
ok('2c · una semana que no existe da vacío, no revienta',
   Object.keys(viejo._trDiasDeLaSemana('2030-01-07')).length === 0);
// ⚠️ El RESPALDO (sin el servicio cargado) tiene su propio filtro por formato
//    de fecha, y las aserciones de arriba no lo tocan: con TrainingSync
//    presente nunca se ejecuta. Se prueba aparte, o sería código sin medir.
{
    const ls = { cronos_training_weeks: JSON.stringify({
        [SEMANA]: Object.assign({ createdBy: 'u1', lastModified: 'x' }, DIAS) }) };
    const sb = {
        console: { log() {}, warn() {}, error() {} },
        JSON, Object, String, RegExp,
        localStorage: { getItem: (k) => (k in ls ? ls[k] : null) }
    };
    sb.window = sb;                       // sin TrainingSync: cae al respaldo
    vm.createContext(sb);
    vm.runInContext((SRC_NOTIFY.match(/function _trDiasDeLaSemana\(weekKey\)[\s\S]*?\n\}/) || [''])[0], sb);
    const r = sb._trDiasDeLaSemana(SEMANA);
    ok('2b-bis · sin el servicio, el respaldo lee el formato legado',
       Object.keys(r).length === 3, JSON.stringify(Object.keys(r)));
    ok('2c-bis · …y filtra los metadatos igual',
       !('createdBy' in r) && !('lastModified' in r), JSON.stringify(Object.keys(r)));
}

ok('2d · y una semana de verdad vacía sigue bloqueando el envío',
   hayAlgoQueEnviar(viejo._trDiasDeLaSemana('2030-01-07')) === false,
   'el aviso tiene que seguir existiendo para el caso que sí lo merece');

// ── PARTE 3 · ⚠️ el MISMO defecto estaba en TRES sitios ─────────────
console.log('\nPARTE 3 · ningún sitio vuelve a leer los días a pelo');
const NOTIFY = sinCom(SRC_NOTIFY), PARENT = sinCom(SRC_PARENT);
// El patrón del defecto: sacar la semana del almacén y bajar directo a la
// fecha, sin pasar por el lector que sabe de `teams.<teamId>`.
ok('3a · el envío interno usa el lector único',
   /TrainingSync\.readWeekDays\(/.test(NOTIFY));
ok('3b · …y la modal de envío también (o se abriría sin lugar ni hora)',
   (NOTIFY.match(/_trDiasDeLaSemana\(/g) || []).length >= 3,
   'definición + los dos sitios que la usaban a pelo');
ok('3c · el envío semanal a las familias también',
   /TrainingSync\.readWeekDays\(/.test(PARENT));
// ⚠️ Que no quede ningún `[weekKey]` seguido de un acceso por fecha.
ok('3d · ⚠️ nadie construye ya `semana[fecha]` desde el almacén crudo',
   !/getItem\('cronos_training_weeks'\)[^;]*\)\[weekKey\]\s*\|\|\s*\{\}\s*;\s*\n[\s\S]{0,200}weekData\[/.test(NOTIFY));

console.log('\n------------------------------------------------------------');
console.log('Resultado: ' + ok_ + '/' + n + ' pruebas superadas.');
process.exit(mal > 0 ? 1 : 0);

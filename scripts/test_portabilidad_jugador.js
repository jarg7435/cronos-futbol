// ═══════════════════════════════════════════════════════════════════════════
//  GUARD · v848 · PORTABILIDAD DE LOS DATOS DE UN JUGADOR (JSON / CSV)
// ═══════════════════════════════════════════════════════════════════════════
//  Reauditoría del 31-10: «la portabilidad estructurada JSON/CSV sigue
//  pendiente». js/admin/shared/portabilidad.js la construye desde la pestaña
//  de Informes de Dirección.
//
//  🔑 LO QUE SE EJECUTA, no sólo se lee:
//   1. QUIÉN ES «ESTE JUGADOR» en los informes — con dorsales por jornada el
//      #7 de hoy puede ser otro niño. Entregar a una familia los minutos de
//      otro menor sería una fuga, no un error de cuentas.
//   2. Que las cifras por partido SUMAN lo mismo que la fila del acumulado de
//      pantalla: si discreparan, el club entregaría un fichero que contradice
//      lo que él mismo ve.
//   3. Que en el fichero NO salen terceros: comentarios del partido, otros
//      jugadores, el correo del entrenador.
// ═══════════════════════════════════════════════════════════════════════════
'use strict';

const fs   = require('fs');
const path = require('path');
const vm   = require('vm');

const RAIZ = path.join(__dirname, '..');
const leer = (r) => fs.readFileSync(path.join(RAIZ, r), 'utf8');
const CT    = leer('js/admin/shared/category-tree.js');
const UTILS = leer('js/core/utils.js');
const PORTA = leer('js/admin/shared/portabilidad.js');
const TAB   = leer('js/coach/reports/reports-tab.js');
const EXP   = leer('js/coach/reports/reports-export.js');
const IDX   = leer('index.html');
const SW    = leer('sw.js');

let pass = 0, fail = 0;
const ok = (n, cond, extra) => {
    if (cond) { pass++; console.log('  ✓ ' + n); }
    else { fail++; console.log('  ✗ ' + n); if (extra !== undefined) console.log('      → ' + String(typeof extra === 'string' ? extra : JSON.stringify(extra)).slice(0, 500)); }
};
const funcion = (src, desde) => {
    const i = src.indexOf(desde); if (i < 0) throw new Error('No está: ' + desde);
    let p = 0, j = src.indexOf('{', i);
    for (; j < src.length; j++) { if (src[j] === '{') p++; else if (src[j] === '}') { p--; if (!p) break; } }
    return src.slice(i, j + 1);
};

console.log('\n══ 📦 v848 · portabilidad de los datos de un jugador ══');

// ── El sandbox: el acumulador REAL + el módulo entero ──────────────────
const S = { console: { log() {}, warn() {} }, JSON, Object, Array, String, Number, Math, Date, parseInt, isNaN, Infinity };
S.window = S;
S.ctNormCat = (x) => x; S.ctNormSubcat = (x) => x;
vm.createContext(S);
const ayudantes = ['function _ctToSeconds(', 'function _ctYellowsIn(', 'function _ctIsRed(',
                   'function _ctEmpezoDeTitular(', 'function _ctMatchPR(']
    .map(n => CT.indexOf(n) >= 0 ? funcion(CT, n) : '').join('\n');
vm.runInContext(ayudantes + '\nfunction _ctTeamLabel(){return "";}\n' +
                funcion(CT, 'window.ctAccumulatePlayerStats = function (matches)') + ';\n' +
                funcion(UTILS, 'function cronosEnfrentamiento(') + '\nwindow.cronosEnfrentamiento = cronosEnfrentamiento;', S);
S.CronosAttendance = { motivoLabel: (id) => ({ estudios: 'Estudios', medico: 'Motivo médico / lesión' })[id] || '' };
vm.runInContext(PORTA, S);

const doc = (o) => Object.assign({ minutesPlayed: '10:00', goals: 0, history: [] }, o);
const ANA = { ficha: 'ALC07', dorsal: '7', nombre: 'ANA GARCÍA', alias: 'Ana' };

// Partidos del Alevín C.
const propios = [
    // Informe VIEJO (sin código): su dorsal era el de plantilla.
    { key: 'm1', matchId: 'm1', matchDate: '2026-09-06', rival: 'Arinaga', scoreHome: 2, scoreAway: 1, myTeamRole: 'home',
      matchComments: [{ text: 'COMENTARIO_DEL_STAFF' }], coachEmail: 'coach@club.es',
      players: [doc({ playerNumber: '7', playerAlias: 'Ana', goals: 1 })] },
    // 🔑 Dorsales POR JORNADA: Ana lleva el 9 y LEO lleva el 7.
    { key: 'm2', matchId: 'm2', matchDate: '2026-09-13', rival: 'Telde', scoreHome: 0, scoreAway: 3, myTeamRole: 'away',
      players: [doc({ playerNumber: '9', playerAlias: 'Ana', playerCode: 'ALC07', rosterNumber: '7', minutesPlayed: '35:00', goals: 2 }),
                doc({ playerNumber: '7', playerAlias: 'LEO_OTRO_NINO', playerCode: 'ALC03', rosterNumber: '3', minutesPlayed: '40:00', goals: 4 }),
                // Un invitado de OTRO equipo en nuestro partido: no es Ana.
                doc({ playerNumber: '15', playerAlias: 'INVITADO_AJENO', isGuest: true, originPlayerId: 'CDA05' })] },
    { key: 'm3', matchId: 'm3', matchDate: '2026-09-20', rival: 'Gáldar', scoreHome: 1, scoreAway: 1, myTeamRole: 'home',
      players: [doc({ playerNumber: '7', playerAlias: 'Ana', playerCode: 'ALC07', rosterNumber: '7', minutesPlayed: '00:00' })] },
];
// Un partido del Infantil donde Ana subió como plaza de apoyo.
const deOtro = { key: 'm4', matchId: 'm4', matchDate: '2026-09-27', rival: 'Moya', scoreHome: 1, scoreAway: 0,
                 myTeamRole: 'home', category: 'infantil', subcategory: 'A',
                 players: [doc({ playerNumber: '18', playerAlias: 'Ana', isGuest: true, originPlayerId: 'ALC07', minutesPlayed: '12:30' }),
                           doc({ playerNumber: '7', playerAlias: 'OTRO_INFANTIL', playerCode: 'INA07', rosterNumber: '7' })] };

const asistencia = { days: { '2026-09-02': { s: 'P', t: 'entreno' }, '2026-09-04': { s: 'J', t: 'entreno', m: 'medico' },
                             '2026-09-03': { s: 'R', t: 'entreno', m: 'estudios' } } };

const datos = S.cronosPortabilidadJugador({
    club: { id: 'club_dia', nombre: 'CD DÍA' },
    equipo: { teamId: 'club_dia__alevin__c', categoria: 'alevin', subcategoria: 'C', etiqueta: 'Alevín C' },
    jugador: ANA, partidosEquipo: propios, partidosClub: propios.concat([deOtro]),
    asistencia, generadoPor: { uid: 'uid_dd', nombre: 'DIRECTOR', rol: 'director' }, ahora: '2026-10-31T10:00:00.000Z',
});
const txt = JSON.stringify(datos);

console.log('\n1) 🔑 QUIÉN ES «ESTE JUGADOR»');
ok('1a · sus 3 partidos con su equipo, incluido el informe VIEJO sin código',
   datos.partidos.map(p => p.partidoId).join(',') === 'm1,m2,m3', datos.partidos.map(p => p.partidoId));
ok('1b · 🔑🔑 en m2 su dorsal de la jornada era el 9: sale el 9, no el 7 de Leo',
   datos.partidos[1].participacion.dorsal === '9' && datos.partidos[1].participacion.goles === 2,
   datos.partidos[1].participacion);
ok('1c · 🚨 NADA del otro niño que llevaba su dorsal de plantilla (ni nombre ni goles)',
   !/LEO_OTRO_NINO/.test(txt) && !datos.partidos.some(p => p.participacion.goles === 4));
ok('1d · el invitado de otro equipo en su partido no se le atribuye', !/INVITADO_AJENO/.test(txt));
ok('1e · la plaza de apoyo con el Infantil sale como colaboración, con su equipo anfitrión',
   datos.colaboraciones.length === 1 && datos.colaboraciones[0].partidoId === 'm4' &&
   datos.colaboraciones[0].equipoAnfitrion === 'infantil A' && datos.colaboraciones[0].participacion.minutos === 12,
   datos.colaboraciones);
ok('1f · …y nada del infantil que lleva el 7 allí', !/OTRO_INFANTIL/.test(txt));

console.log('\n2) 🔑 LAS CIFRAS SON LAS DE LA PANTALLA');
const fila = S.ctAccumulatePlayerStats(propios).find(f => f.ficha === 'ALC07');
const suma = (k) => datos.partidos.reduce((s, p) => s + (p.participacion[k] || 0), 0);
ok('2a · el resumen de temporada ES la fila del acumulado de su equipo',
   !!fila && datos.resumenTemporada.minutos === fila.minutes && datos.resumenTemporada.goles === fila.goals &&
   datos.resumenTemporada.convocatorias === fila.called && datos.resumenTemporada.partidosJugados === fila.pj,
   { fila, resumen: datos.resumenTemporada });
ok('2b · 🔑 y la suma partido a partido da lo mismo (segundos y goles)',
   suma('segundos') === datos.resumenTemporada.segundos && suma('goles') === datos.resumenTemporada.goles,
   { seg: suma('segundos'), goles: suma('goles'), r: datos.resumenTemporada });
ok('2c · convocada sin jugar (m3, 00:00) no cuenta como jugado', datos.partidos[2].participacion.jugo === false);
ok('2d · localía y resultado: el 0-3 jugando FUERA es VICTORIA',
   datos.partidos[1].localia === 'visitante' && datos.partidos[1].resultado === 'VICTORIA' && datos.partidos[1].marcador === '0-3');

console.log('\n3) 🚨 SIN DATOS DE TERCEROS');
ok('3a · ni los comentarios del staff ni el correo del entrenador',
   !/COMENTARIO_DEL_STAFF/.test(txt) && !/coach@club\.es/.test(txt));
ok('3b · y el JSON dice qué excluye y por qué (contactos de la familia incluidos)',
   datos.notas.excluye.some(t => /contactos de la familia/.test(t)) && datos.notas.excluye.some(t => /terceros/.test(t)));

console.log('\n4) ASISTENCIA');
ok('4a · ordenada por fecha y con el texto del estado',
   datos.asistencia.disponible && datos.asistencia.dias.map(d => d.fecha).join(',') === '2026-09-02,2026-09-03,2026-09-04' &&
   datos.asistencia.dias[1].estadoTexto === 'Presente con retraso', datos.asistencia);
ok('4b · el motivo sale con su etiqueta (la lista única de asistencia)', datos.asistencia.dias[2].motivoTexto === 'Motivo médico / lesión');
const sinAsis = S.cronosPortabilidadJugador({ jugador: ANA, partidosEquipo: [], asistencia: null });
ok('4c · sin registro: disponible=false y cero en todo (no revienta)',
   sinAsis.asistencia.disponible === false && sinAsis.partidos.length === 0 && sinAsis.resumenTemporada.minutos === 0);

console.log('\n5) ESTRUCTURA LIMPIA');
ok('5a · esquema versionado y vuelta JSON idéntica',
   datos.esquema === 'chronos.portabilidad.jugador/1' && JSON.stringify(JSON.parse(txt)) === txt);
const fp = S.cronosPortabilidadFilasPartidos(datos), fa = S.cronosPortabilidadFilasAsistencia(datos);
ok('5b · CSV de partidos: UNA cabecera y una fila por partido (3 + 1 colaboración)',
   fp.length === 5 && fp[0][0] === 'Fecha' && fp.slice(1).every(r => r.length === fp[0].length), fp);
ok('5c · CSV de asistencia: cabecera + 3 días', fa.length === 4 && fa[0].join('|') === 'Fecha|Sesión|Estado|Motivo');

console.log('\n6) CABLEADO');
ok('6a · la barra va en la pestaña de Dirección y la puerta es la del responsable',
   /const _sdPortaBar = \(catId, subId\) => !_sdPuedePorta \? ''/.test(TAB) &&
   /window\._sdPuedeAtenderDerechos\(me\)/.test(TAB) && /_sdStatsBar\(arr, catId, subId\) \+ _sdPortaBar\(catId, subId\)/.test(TAB));
ok('6b · trabaja sobre lo ya leído: la pestaña publica partidos y plantillas',
   /window\._sdPartidosClub = sorted;/.test(TAB) && /window\._sdPlantillasData = _sdPlantillas;/.test(TAB));
ok('6c · cargado en index.html y en el precache del SW',
   /<script src="js\/admin\/shared\/portabilidad\.js\?v=v\d+"><\/script>/.test(IDX) && SW.includes("'./js/admin/shared/portabilidad.js'"));
const cJSON = funcion(EXP, 'window.rxDescargarJSON = function');
ok('6d · el JSON se entrega como el CSV (menú del sistema ANTES del <a>) y en UTF-8',
   cJSON.indexOf('_rxCompartirFichero(') >= 0 && cJSON.indexOf('_rxCompartirFichero(') < cJSON.indexOf('URL.createObjectURL') &&
   /application\/json/.test(cJSON) && !/_rxUtf16le/.test(cJSON));
ok('6e · ⚠️ se prepara ANTES y el botón sólo entrega (gesto del usuario en el iPad)',
   !/await/.test(funcion(PORTA, 'window.cronosPortabilidadDescargar = function')));
{
    const P = { window: null };
    P.window = P;
    vm.createContext(P);
    vm.runInContext(funcion(leer('js/coach/reports/club-reports.js'), 'function _sdEsEntornoIndividual(') + '\n' +
                    funcion(leer('js/coach/reports/club-reports.js'), 'function _sdPuedePurgar(') +
                    '\nwindow._sdPuedePurgar = _sdPuedePurgar;\n' +
                    funcion(PORTA, 'window._sdPuedeAtenderDerechos = function') + ';', P);
    const puede = (u) => P._sdPuedeAtenderDerechos(u);
    ok('6f · Director y Admin de Club sí; coordinador, entrenador y familia NO',
       puede({ role: 'director' }) && puede({ role: 'user', _activeRole: 'club_admin' }) &&
       !puede({ role: 'director', _activeRole: 'coordinator' }) && !puede({ role: 'user' }) && !puede({ role: 'parent' }));
}

console.log('\n' + pass + '/' + (pass + fail) + ' aserciones OK');
process.exit(fail ? 1 : 0);

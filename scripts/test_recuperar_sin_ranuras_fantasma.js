// ─────────────────────────────────────────────────────────────────────────
// test_recuperar_sin_ranuras_fantasma.js · "Recuperar Partido en Curso" no
// puede enseñar dos veces el mismo equipo (v561)
//
// Reporte del autor (captura 9075): en el panel de recuperación salía el
// Alevín C DUPLICADO — arriba una tarjeta de F-11 con 18 jugadores y 24
// minutos, abajo el partido real de F-7 con 14.
//
// 🔑🔑🔑 NO HABÍA NINGUNA RANURA FANTASMA. Medido en producción, las dos
// tarjetas eran DOS PARTIDOS DE VERDAD de la misma entrenadora:
//
//    f7   14j  30min   category=alevin   matchCategory=alevin     ← Alevín C
//    f11  18j  28min   category=alevin   matchCategory=regional   ← ¡Regional A!
//
// El documento lleva DOS identidades y no coinciden: `matchCategory` es la del
// PARTIDO (la buena) y `category` la del PERFIL del entrenador cuando se
// escribió el latido — que en quien lleva dos equipos se queda con la del otro.
// Y el `teamId` se sellaba igual de mal. La tarjeta se etiquetaba con la del
// perfil, así que el partido del Regional se presentaba como un segundo Alevín.
//
// ⚠️ POR ESO NO SE PODÍA "DESCARTAR LA FANTASMA": era un partido en curso de
// verdad. Ocultarla lo habría dejado irrecuperable — peor que la confusión.
//
// LO QUE FIJA ESTE GUARD:
//   A · el resolutor de identidad antepone la categoría DEL PARTIDO;
//   B · valida modalidad y nº de jugadores, contando POR EQUIPO (con el
//       contrario analizado el documento lleva las dos plantillas);
//   C · sólo se descarta lo que NO PUEDE SER un partido: incoherente Y sin un
//       segundo jugado, ni un gol, ni un jugador;
//   D · el emisor sella el `teamId` con el equipo DEL PARTIDO, sin el prefijo
//       de modalidad;
//   E · las dos listas del panel —con red y sin red— usan el MISMO resolutor.
// ─────────────────────────────────────────────────────────────────────────
'use strict';

const fs   = require('fs');
const path = require('path');
const vm   = require('vm');

const ROOT = path.join(__dirname, '..');
let fail = 0, pass = 0;
const ok = (name, cond, extra) => {
    if (cond) { pass++; console.log('PASS ' + name); }
    else { fail++; console.log('FAIL ' + name); if (extra !== undefined) console.log('       ' + extra); }
};

const UTILS = fs.readFileSync(path.join(ROOT, 'js', 'core', 'utils.js'), 'utf8');
const SETUP = fs.readFileSync(path.join(ROOT, 'js', 'core', 'setup-modal.js'), 'utf8');
const SYNC  = fs.readFileSync(path.join(ROOT, 'js', 'match', 'live', 'sync.js'), 'utf8');

function trozo(src, cabecera, cierre) {
    const i = src.indexOf(cabecera);
    if (i < 0) throw new Error('No se encontró ' + cabecera);
    const j = src.indexOf(cierre, i);
    if (j < 0) throw new Error('No se encontró el cierre de ' + cabecera);
    return src.slice(i, j + cierre.length);
}

// El resolutor y sus dependencias reales de utils.js.
const FUENTE =
    trozo(UTILS, 'function _cronosNoEsAcento(caracter) {', '\n}') + '\n' +
    trozo(UTILS, 'function cronosTeamSlug(valor) {', '\n}') + '\n' +
    trozo(UTILS, "if (typeof window._cronosMatchModality !== 'function') {", '\n}\n') + '\n' +
    trozo(UTILS, "if (typeof window.cronosNombreCategoria !== 'function') {", '\n}\n') + '\n' +
    trozo(UTILS, "if (typeof window.cronosIdentidadDelPartido !== 'function') {", '\n}\n');

function montar() {
    const sb = { console: { log() {}, warn() {} }, String, Number, Array, Object, Math, JSON };
    sb.window = sb;
    vm.createContext(sb);
    vm.runInContext(FUENTE, sb);
    return sb;
}
const SB = montar();
const ident = (d) => SB.window.cronosIdentidadDelPartido(d);

console.log('── Recuperar Partido: una tarjeta por equipo, bien etiquetada (v561) ──\n');

// ═══════════════════════════════════════════════════════════════════════
//  PARTE 1 · LOS DOS DOCUMENTOS REALES DE LA CAPTURA 9075
// ═══════════════════════════════════════════════════════════════════════
console.log('── PARTE 1 · los dos partidos de la captura, tal cual están en producción ──');
{
    // Copiados de la lectura por REST del 2026-08-16.
    const ALEVIN = {
        mode: 'f7', category: 'alevin', subcategory: 'C',
        matchCategory: 'alevin', matchSubcategory: 'C',
        teamId: 'club-mqvr9m11-g9kj__alevin__c',
        timeH1: 1800, timeH2: 0, playerCount: 14,
        homeTeam: { name: 'LOCAL', score: 0 }, awayTeam: { name: 'VISITANTE', score: 0 },
    };
    const REGIONAL = {
        mode: 'f11', category: 'alevin', subcategory: 'C',   // ← el perfil, MAL
        matchCategory: 'regional', matchSubcategory: 'A',    // ← el partido, BIEN
        teamId: 'club-mqvr9m11-g9kj__alevin__c',             // ← sellado mal
        timeH1: 1680, timeH2: 0, playerCount: 18,
        homeTeam: { name: 'LOCAL', score: 0 }, awayTeam: { name: 'VISITANTE', score: 0 },
    };

    const a = ident(ALEVIN), r = ident(REGIONAL);

    ok('1a · 🔑🔑🔑 las dos tarjetas dejan de llamarse igual',
       a.etiqueta !== r.etiqueta, a.etiqueta + ' / ' + r.etiqueta);
    ok('1b · la primera es el Alevín C en F-7',
       /Alev/.test(a.etiqueta) && a.modalidadLabel === 'F-7',
       a.etiqueta + ' · ' + a.modalidadLabel);
    ok('1c · 🔑 y la "fantasma" es el REGIONAL A en F-11 (no un segundo Alevín)',
       /Regional/.test(r.etiqueta) && r.modalidadLabel === 'F-11',
       r.etiqueta + ' · ' + r.modalidadLabel);
    ok('1d · las dos son coherentes: 14 en F-7 y 18 en F-11 es lo correcto',
       a.coherente && r.coherente, JSON.stringify([a.motivos, r.motivos]));
    ok('1e · ⚠️ pero se DELATA el sello ajeno del documento del Regional',
       r.selloAjeno === true && a.selloAjeno === false,
       'es el defecto de origen: category/teamId venían del perfil');
}

// ═══════════════════════════════════════════════════════════════════════
//  PARTE 2 · LA VALIDACIÓN ESTRICTA
// ═══════════════════════════════════════════════════════════════════════
console.log('\n── PARTE 2 · modalidad y jugadores contra la categoría del partido ──');
{
    // El caso REAL de datos imposibles que también salió en producción:
    // 18 jugadores declarados en Fútbol 7.
    const i18f7 = ident({ mode: 'f7', matchCategory: 'f7_alevin', playerCount: 18 * 2 + 1 });
    ok('2a · 18+ jugadores en un equipo de F-7 se marca como incoherente',
       !i18f7.coherente, JSON.stringify(i18f7.motivos));

    // La modalidad declarada contradice a la categoría.
    const cruz = ident({ mode: 'f7', matchCategory: 'regional', playerCount: 14 });
    ok('2b · declarar F-7 en un partido de Regional se marca como incoherente',
       !cruz.coherente && /pide F11/.test(cruz.motivos.join(' ')),
       JSON.stringify(cruz.motivos));

    // ⚠️ Y LO QUE NO PUEDE DAR FALSO POSITIVO ─────────────────────────
    // El panel ofrece "Juvenil (2T x 45')" TAMBIÉN en Fútbol 7: un Infantil,
    // Cadete o Juvenil jugando F7 es legítimo y lo decide el club.
    const juvenilF7 = ident({ mode: 'f7', matchCategory: 'f7_juvenil', playerCount: 14 });
    ok('2c · ⚠️ un JUVENIL jugando Fútbol 7 es LEGÍTIMO, no se marca',
       juvenilF7.coherente && juvenilF7.modalidadLabel === 'F-7',
       'el prefijo f7_ del desplegable ES la declaración de modalidad');

    // Con "Analizar Contrario" el documento lleva las DOS plantillas.
    const dosPlantillas = { mode: 'f7', matchCategory: 'f7_alevin', players: [] };
    for (let i = 0; i < 14; i++) dosPlantillas.players.push({ team: 'home' });
    for (let i = 0; i < 14; i++) dosPlantillas.players.push({ team: 'away' });
    const conRival = ident(dosPlantillas);
    ok('2d · ⚠️ 28 jugadores con el CONTRARIO ANALIZADO no es un error (se cuenta por equipo)',
       conRival.coherente && conRival.maxEnUnEquipo === 14,
       JSON.stringify(conRival.motivos) + ' max=' + conRival.maxEnUnEquipo);

    const rivalDesbordado = { mode: 'f7', matchCategory: 'f7_alevin', players: [] };
    for (let i = 0; i < 14; i++) rivalDesbordado.players.push({ team: 'home' });
    for (let i = 0; i < 19; i++) rivalDesbordado.players.push({ team: 'away' });
    ok('2e · pero 19 en UN equipo de F-7 sí lo es',
       !ident(rivalDesbordado).coherente);

    ok('2f · sin datos suficientes no se inventa una incoherencia',
       ident({}).coherente && ident({ playerCount: 14 }).coherente);
}

// ═══════════════════════════════════════════════════════════════════════
//  PARTE 3 · QUÉ SE DESCARTA Y QUÉ NO
// ═══════════════════════════════════════════════════════════════════════
console.log('\n── PARTE 3 · sólo se tira lo que no puede ser un partido ──');
{
    const FUENTE_FILTRO = trozo(SETUP, 'function _cronosDescartaRanurasImposibles(entradas) {', '\n}');
    const sb = { console: { log() {}, warn() {} }, String, Number, Array, Object, Math, JSON };
    sb.window = sb;
    vm.createContext(sb);
    vm.runInContext(FUENTE, sb);
    vm.runInContext(FUENTE_FILTRO, sb);
    const filtra = (arr) => vm.runInContext('_cronosDescartaRanurasImposibles', sb)(arr);

    const conJuego = { datos: {
        mode: 'f7', matchCategory: 'f7_alevin', playerCount: 40,
        timeH1: 1200, homeTeam: { score: 2 }, awayTeam: { score: 1 } } };
    const restoVacio = { datos: {
        mode: 'f11', matchCategory: 'f7_alevin', playerCount: 0,
        timeH1: 0, timeH2: 0, homeTeam: { score: 0 }, awayTeam: { score: 0 } } };
    const sano = { datos: {
        mode: 'f7', matchCategory: 'f7_alevin', playerCount: 14, timeH1: 600,
        homeTeam: { score: 0 }, awayTeam: { score: 0 } } };

    const salida = filtra([conJuego, restoVacio, sano]);
    ok('3a · 🔑 un resto incoherente y SIN NADA jugado se descarta',
       salida.indexOf(restoVacio) === -1);
    ok('3b · 🔑🔑🔑 pero un partido incoherente CON JUEGO se conserva',
       salida.indexOf(conJuego) !== -1,
       'ocultarlo dejaría un partido en curso irrecuperable: peor que el defecto');
    ok('3c · y los sanos, intactos',
       salida.indexOf(sano) !== -1 && salida.length === 2);
    ok('3d · ⚠️ ante un error, se ENSEÑA (nunca se pierde un partido por un fallo del filtro)',
       filtra([{ datos: null }]).length === 1 && filtra(null).length === 0);
}

// ═══════════════════════════════════════════════════════════════════════
//  PARTE 4 · EL CABLEADO
// ═══════════════════════════════════════════════════════════════════════
console.log('\n── PARTE 4 · el cableado del panel y del emisor ──');

ok('4a · 🔑 el emisor sella el teamId con la categoría DEL PARTIDO',
   /_sinPrefijo\(_matchCat\)/.test(SYNC),
   'con la del perfil, el partido del Regional quedaba sellado como Alevín');

ok('4b · ⚠️ y le quita el prefijo de modalidad (f11_regional → regional)',
   /replace\(\/\^f\(\?:7\|8\|11\)_\/i, ''\)/.test(SYNC),
   'sin esto el teamId sería f11-regional y no casaría con la ficha del equipo');

ok('4c · la tarjeta con red se etiqueta con el resolutor único',
   /const _ident = \(typeof window\.cronosIdentidadDelPartido === 'function'\)/.test(SETUP) &&
   /const modeLabel = _ident\.modalidadLabel;/.test(SETUP));

ok('4d · ⚠️ y la lista SIN CONEXIÓN usa el MISMO resolutor',
   /const _identL = \(typeof window\.cronosIdentidadDelPartido === 'function'\)/.test(SETUP),
   'dos pantallas del mismo partido no pueden decir cosas distintas');

ok('4e · las dos listas pasan por el descarte de imposibles',
   (SETUP.match(/_cronosDescartaRanurasImposibles\(/g) || []).length >= 3,
   'la definición más las dos llamadas');

ok('4f · la ranura local viaja con su categoría de PARTIDO y sus jugadores en crudo',
   /matchCategory: parsed\.category \|\| '',/.test(SETUP) &&
   /players: Array\.isArray\(parsed\.players\) \? parsed\.players : null,/.test(SETUP),
   'sin los jugadores no se puede contar por equipo');

ok('4g · el aviso de datos cruzados se pinta en las dos tarjetas',
   (SETUP.match(/\$\{avisoIncoherente\}/g) || []).length === 2);

console.log('\n────────────────────────────────');
console.log('PASS: ' + pass + '   FAIL: ' + fail);
process.exit(fail === 0 ? 0 : 1);

// ─────────────────────────────────────────────────────────────────────────
// test_auditoria_aislamiento_alertas.js · AUDITORÍA: ningún suceso de un
// partido puede avisar en la pantalla de otro (v559)
//
// Petición del autor: *"necesito una garantía técnica absoluta y su
// implementación rigurosa de que los sucesos, avisos y sonidos de un partido en
// directo se retransmiten única y exclusivamente al panel en vivo de ese
// partido, de esa categoría y de esa subcategoría exacta"*.
//
// UNA GARANTÍA NO ES UNA PROMESA EN UN COMENTARIO. Lo que la sostiene es que el
// número de sitios por los que puede salir una alerta sea CERRADO y que todos
// pasen por la misma puerta. Este guard es esa auditoría, escrita de forma que
// se ponga ROJA si alguien añade un emisor nuevo por fuera.
//
// LO QUE SE AUDITA:
//
//  A · EL CENSO DE EMISORES. En live.html sólo hay DOS sitios que puedan
//      interrumpir a alguien: `showEventToast` (aviso + destello + sonido +
//      vibración + cajón) y `_handlePhaseTransition` (silbato + overlay de
//      descanso/final). Se comprueba que los emisores de bajo nivel
//      —`playEventSound`, `vibrate`, `_liveWhistle`, `_enqueueMoment` y el
//      destello— NO se invocan desde ningún otro sitio. Un tercer emisor sin
//      puerta pondría este guard en rojo.
//
//  B · LAS DOS PUERTAS, ejecutadas contra una matriz completa de
//      rol × pantalla × partido.
//
//  C · LA CADENA DE IDENTIDAD, extremo a extremo: cada suceso se escribe con su
//      `matchId`; el emisor se niega a escribir en un partido que no es el de
//      su pestaña (v469); el visor descarta un evento que declare otro partido;
//      y un DOCUMENTO que dice ser otro partido no emite nada (v559).
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

const LIVE    = fs.readFileSync(path.join(ROOT, 'live.html'), 'utf8');
const PACTION = fs.readFileSync(path.join(ROOT, 'js', 'match', 'events', 'player-actions.js'), 'utf8');
const SYNC    = fs.readFileSync(path.join(ROOT, 'js', 'match', 'live', 'sync.js'), 'utf8');

// Quita comentarios de línea y de bloque: un emisor MENCIONADO en un comentario
// no emite nada, y contarlo daría un rojo falso.
function sinComentarios(src) {
    return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/[^\n]*/g, '$1');
}
const L = sinComentarios(LIVE);

// El cuerpo de una función, desde su cabecera hasta la siguiente declaración
// de nivel superior (`\n}` seguido de línea en blanco o de otra función).
function cuerpo(src, cabecera) {
    const i = src.indexOf(cabecera);
    if (i < 0) return '';
    const j = src.indexOf('\n}', i);
    return j < 0 ? src.slice(i) : src.slice(i, j + 2);
}

console.log('── AUDITORÍA · ningún suceso se cuela en otro partido (v559) ──\n');

// ═══════════════════════════════════════════════════════════════════════
//  PARTE A · EL CENSO DE EMISORES ESTÁ CERRADO
// ═══════════════════════════════════════════════════════════════════════
console.log('── PARTE A · el censo de emisores ──');

const CUERPO_TOAST = cuerpo(L, 'function showEventToast(type, line, sub, matchTime, equipo, matchId) {');
const CUERPO_FASE  = cuerpo(L, 'function _handlePhaseTransition(matchId, matchData) {');

ok('A0 · se han localizado las dos funciones que pueden interrumpir',
   CUERPO_TOAST.length > 200 && CUERPO_FASE.length > 200);

// Cada emisor de bajo nivel, con las llamadas que se le permiten y dónde.
const EMISORES = [
    { nombre: 'playEventSound', re: /playEventSound\s*\(/g,  permitido: [CUERPO_TOAST],
      danio: 'el sonido' },
    { nombre: 'vibrate',        re: /(?<!function\s)\bvibrate\s*\(/g, permitido: [CUERPO_TOAST],
      danio: 'la vibración' },
    { nombre: '_liveWhistle',   re: /_liveWhistle\s*\(/g,     permitido: [CUERPO_FASE],
      danio: 'el silbato' },
    { nombre: '_enqueueMoment', re: /_enqueueMoment\s*\(/g,   permitido: [CUERPO_FASE],
      danio: 'el overlay que tapa la pantalla' },
];

EMISORES.forEach(em => {
    // Llamadas en TODO el fichero, menos la propia definición de la función.
    const defRe = new RegExp('function\\s+' + em.nombre + '\\s*\\(');
    const total = (L.match(em.re) || []).length - (defRe.test(L) ? 1 : 0);
    const dentro = em.permitido.reduce((n, blq) => n + ((blq.match(em.re) || []).length), 0);
    ok('A · ' + em.danio + ' (`' + em.nombre + '`) sólo se dispara desde la función con puerta',
       total > 0 && total === dentro,
       'llamadas totales: ' + total + ' · dentro de la función con puerta: ' + dentro +
       ' — un emisor nuevo por fuera se salta el aislamiento');
});

// El destello ocupa la pantalla entera: mismo trato.
{
    const total  = (L.match(/getElementById\("event-flash"\)/g) || []).length;
    const dentro = (CUERPO_TOAST.match(/getElementById\("event-flash"\)/g) || []).length;
    ok('A · el destello a pantalla completa, igual',
       total > 0 && total === dentro, 'totales: ' + total + ' · con puerta: ' + dentro);
}

// Y las puertas están donde tienen que estar.
ok('A1 · ⚠️ la puerta es la PRIMERA línea de showEventToast',
   /function showEventToast\([^)]*\)\s*\{\s*if \(!_puedeAvisarme\(matchId\)\) return;/.test(L),
   'el sonido y la vibración están al FINAL de esa función: filtrar más abajo no los corta');

ok('A2 · y `_handlePhaseTransition` la aplica antes de silbar',
   CUERPO_FASE.indexOf('_puedeAvisarme(matchId)') > 0 &&
   CUERPO_FASE.indexOf('_puedeAvisarme(matchId)') < CUERPO_FASE.indexOf('_liveWhistle('),
   'la fase se sigue anotando; lo que no se hace es anunciarla');

// ═══════════════════════════════════════════════════════════════════════
//  PARTE B · LAS DOS PUERTAS, CONTRA LA MATRIZ COMPLETA
// ═══════════════════════════════════════════════════════════════════════
console.log('\n── PARTE B · la decisión, en toda la matriz ──');
{
    const ini = LIVE.indexOf('function _soyDestinatarioDe(m) {');
    const fin = LIVE.indexOf('// v455 · `matchId` (6º argumento) es el partido AL QUE PERTENECE el suceso.');
    const FUENTE = LIVE.slice(ini, fin);

    // Tres partidos: dos del club (equipos DISTINTOS) y uno ajeno.
    const PARTIDOS = {
        alevin:   { id: 'alevin',   clubId: 'cd-dia', createdBy: 'uid-ana',  coachEmail: 'ana@x.com',
                    category: 'alevin',   subcategory: 'C', teamId: 'cd-dia__alevin__c' },
        regional: { id: 'regional', clubId: 'cd-dia', createdBy: 'uid-luis', coachEmail: 'luis@x.com',
                    category: 'regional', subcategory: 'A', teamId: 'cd-dia__regional__a' },
        ajeno:    { id: 'ajeno',    clubId: 'otro',   createdBy: 'uid-z',    coachEmail: 'z@x.com',
                    category: 'juvenil',  subcategory: 'B', teamId: 'otro__juvenil__b' },
    };

    function juez(quien, viendo, enListado) {
        const sb = {
            console: { warn() {}, log() {} }, String, Object,
            userData: quien, currentMatchId: viendo,
            _matchLastData: PARTIDOS,
            _avisosEnListado: () => !!enListado,
        };
        sb.window = sb;
        vm.createContext(sb);
        vm.runInContext(FUENTE, sb);
        return (id) => vm.runInContext('_puedeAvisarme(' + JSON.stringify(id) + ')', sb);
    }

    const ANA   = { uid: 'uid-ana',  email: 'ana@x.com',  role: 'user',        clubId: 'cd-dia' };
    const LUIS  = { uid: 'uid-luis', email: 'luis@x.com', role: 'user',        clubId: 'cd-dia' };
    const DIR   = { uid: 'uid-dir',  email: 'dir@x.com',  role: 'director',    clubId: 'cd-dia' };
    const COORD = { uid: 'uid-co',   email: 'co@x.com',   role: 'coordinator', clubId: 'cd-dia' };
    const PADRE = { uid: 'uid-pa',   email: 'pa@x.com',   role: 'parent',      clubId: 'cd-dia' };
    const SA    = { uid: 'uid-sa',   email: 'sa@x.com',   role: 'superadmin' };

    // ── B1 · DENTRO DE UN PARTIDO: NADIE, DE NINGÚN ROL, RECIBE OTRO ──
    const ids = Object.keys(PARTIDOS);
    let fugas = [];
    [ANA, LUIS, DIR, COORD, PADRE, SA].forEach(quien => {
        ids.forEach(viendo => {
            const puede = juez(quien, viendo, false);
            ids.forEach(suceso => {
                const r = puede(suceso);
                if (suceso === viendo && r !== true) fugas.push('NO avisa de lo suyo: ' + quien.role + ' viendo ' + viendo);
                if (suceso !== viendo && r !== false) fugas.push('FUGA: ' + quien.role + ' viendo ' + viendo + ' recibe ' + suceso);
            });
        });
    });
    ok('B1 · 🔑🔑🔑 en el DETALLE, ningún rol recibe jamás un suceso de otro partido (6 roles × 3 partidos × 3 sucesos)',
       fugas.length === 0, fugas.join('\n       '));

    // ── B2 · EN EL LISTADO, cada rol recibe exactamente lo que le toca ──
    const ESPERADO_LISTADO = [
        [ANA,   { alevin: true,  regional: false, ajeno: false }, 'la entrenadora del Alevín, sólo su equipo'],
        [LUIS,  { alevin: false, regional: true,  ajeno: false }, 'el entrenador del Regional, sólo el suyo'],
        [DIR,   { alevin: true,  regional: true,  ajeno: false }, 'el director deportivo, todos los de SU club'],
        [COORD, { alevin: true,  regional: true,  ajeno: false }, 'el coordinador, igual que el director'],
        [PADRE, { alevin: false, regional: false, ajeno: false }, 'el padre, sólo el partido que abre por enlace'],
        [SA,    { alevin: true,  regional: true,  ajeno: true  }, 'el SuperAdmin supervisa la plataforma'],
    ];
    let malListado = [];
    ESPERADO_LISTADO.forEach(([quien, esperado, motivo]) => {
        const puede = juez(quien, null, true);
        Object.keys(esperado).forEach(id => {
            if (puede(id) !== esperado[id]) {
                malListado.push(quien.role + ' + ' + id + ' → ' + puede(id) +
                                ' (se esperaba ' + esperado[id] + ': ' + motivo + ')');
            }
        });
    });
    ok('B2 · 🔑 en el LISTADO, cada rol recibe EXACTAMENTE los partidos que le corresponden',
       malListado.length === 0, malListado.join('\n       '));

    ok('B3 · ⚠️ el padre sigue recibiendo el partido que ha abierto por enlace directo',
       juez(PADRE, 'alevin', false)('alevin') === true,
       'sin esto se quedaría sin avisos en el único partido que puede ver');
}

// ═══════════════════════════════════════════════════════════════════════
//  PARTE C · LA CADENA DE IDENTIDAD, EXTREMO A EXTREMO
// ═══════════════════════════════════════════════════════════════════════
console.log('\n── PARTE C · la identidad del partido, de punta a punta ──');

ok('C1 · cada suceso se escribe CON su partido dentro (`matchId` en el evento)',
   /matchId: _evMatchId,/.test(PACTION) &&
   /var _evMatchId = \(typeof liveMatchId !== 'undefined' && liveMatchId\)/.test(PACTION));

ok('C2 · 🔒 el emisor se niega a escribir un suceso en un partido que no es el de su pestaña (v469)',
   /Suceso BLOQUEADO/.test(PACTION) && /_propio !== _id/.test(PACTION));

ok('C3 · 🔒 y tampoco manda el latido al documento equivocado',
   /Latido BLOQUEADO/.test(SYNC) && /_propio !== liveMatchId/.test(SYNC));

{
    const FUENTE = cuerpo(LIVE, 'function _eventBelongsTo(ev, matchId) {');
    const sb = { console: { warn() {} } };
    sb.window = sb;
    vm.createContext(sb);
    vm.runInContext(FUENTE, sb);
    const pertenece = (ev, id) => vm.runInContext('_eventBelongsTo(' + JSON.stringify(ev) + ',' + JSON.stringify(id) + ')', sb);
    ok('C4 · el visor descarta un evento que declare OTRO partido, aunque llegue dentro de este documento',
       pertenece({ matchId: 'm-alevin' }, 'm-regional') === false &&
       pertenece({ matchId: 'm-regional' }, 'm-regional') === true &&
       pertenece({}, 'm-regional') === true);   // legado sin matchId: viene dentro del doc
}

ok('C5 · 🔑 y un DOCUMENTO que dice ser otro partido no emite NADA (v559)',
   /Documento CRUZADO/.test(LIVE) &&
   /if \(matchData && matchData\.id && matchData\.id !== matchId\)/.test(LIVE),
   'es la huella del defecto de v558: dos partidos escribiendo en el mismo sitio');

// La comprobación va ANTES de cualquier procesado, o no serviría.
{
    const c = cuerpo(L, 'function detectAndAlert(matchId, matchData, fromCache) {');
    ok('C6 · ⚠️ esa comprobación es lo PRIMERO de detectAndAlert',
       c.indexOf('matchData.id !== matchId') > 0 &&
       c.indexOf('matchData.id !== matchId') < c.indexOf('_handlePhaseTransition('),
       'después de procesar ya sería tarde');
}

// v561 · El sello sigue estando, pero ahora se construye con la categoría DEL
// PARTIDO (`_matchCat`) y no con la del perfil del entrenador: con la del
// perfil, el partido del Regional quedaba sellado como Alevín y el panel de
// recuperación pintaba dos veces el mismo equipo (captura 9075).
ok('C7 · el partido lleva escrito su equipo exacto: club + categoría + subcategoría',
   /teamId: \(function \(\) \{/.test(SYNC) &&
   /cronosTeamId\(_u\.clubId \|\| '', _cat, _sub\) \|\| null/.test(SYNC) &&
   /_sinPrefijo\(_matchCat\)/.test(SYNC),
   'la unidad que nombra el autor, en el propio dato, y tomada DEL PARTIDO');

console.log('\n────────────────────────────────');
console.log('PASS: ' + pass + '   FAIL: ' + fail);
process.exit(fail === 0 ? 0 : 1);

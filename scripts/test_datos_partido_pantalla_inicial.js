// ═══════════════════════════════════════════════════════════════════════════
//  GUARD · v726 · LA PANTALLA INICIAL DEL PARTIDO DECIDE, Y NADA SALE GENÉRICO
// ═══════════════════════════════════════════════════════════════════════════
//  Encargo del autor (implementar.txt 2026-09-17, IMG_2759-2764 + captura
//  10485), tres puntos:
//
//   1 · Las plantillas guardadas no salían al abrir el panel («-- Cargar --»,
//       «Sin plantillas en esta modalidad») hasta entrar y salir de GESTIONAR
//       PLANTILLA. 🔑 Era una CARRERA: init() pinta el panel y después baja
//       `cronos_teams` de la nube sin repintar. Y aun cargada, el desplegable
//       volvía a «-- Cargar --» porque `syncSetupMode` lo repoblaba.
//   2 · El tipo de partido y la jornada del calendario vivían en la
//       Convocatoria: se podía montar el partido de LOCAL y descubrir allí que
//       el calendario lo jugaba FUERA. Ahora van en la pantalla inicial, y en
//       Liga la jornada fija localía y rival.
//   3 · El marcador y el visor rotulaban «LOCAL 2 – 0 VISITANTE».
//
//  Se EJECUTA el producto (team-persistence.js, setup-modal.js y el helper del
//  visor) contra un DOM de juguete; lo que no se puede ejecutar sin navegador
//  se fija sobre el fuente.
// ═══════════════════════════════════════════════════════════════════════════
'use strict';

const fs   = require('fs');
const path = require('path');
const vm   = require('vm');

const RAIZ = path.join(__dirname, '..');
const leer = f => fs.readFileSync(path.join(RAIZ, f), 'utf8');

let fallos = 0, total = 0;
function ok(nombre, cond, detalle) {
    total++;
    if (cond) console.log('  ✓ ' + nombre);
    else {
        console.log('  ✗ ' + nombre);
        if (detalle !== undefined) console.log('      ' + String(detalle).slice(0, 300));
        fallos++;
    }
}

const PERSIST = leer('js/match/persistence/team-persistence.js');
const SETUP   = leer('js/core/setup-modal.js');
const IMPORT  = leer('js/ai/import.js');
const APPINIT = leer('js/core/app-init.js');
const STORAGE = leer('js/services/firestore-storage.js');
const CORE    = leer('js/match/timer/core.js');
const INDEX   = leer('index.html');
const LIVE    = leer('live.html');

// ── DOM de juguete: cualquier id existe; los <select> guardan su valor ─────
function nuevoDom(valores) {
    const porId = {};
    const el = (id) => {
        if (!porId[id]) {
            porId[id] = {
                id, value: '', disabled: false, readOnly: false, title: '', checked: false,
                style: {}, dataset: {}, children: [], textContent: '', _html: '',
                classList: { add() {}, remove() {}, toggle() {}, contains() { return false; } },
                appendChild(h) { this.children.push(h); },
                addEventListener() {}, dispatchEvent() {}, focus() {},
                querySelector() { return null; },
                get innerHTML() { return this._html; },
                // ⚠️ Como un <select> real: rehacer sus opciones SUELTA el valor.
                // Sin esto 1g nacía en VERDE FALSO (red-check M1b): era
                // justo el mecanismo del defecto de IMG_2761.
                set innerHTML(v) { this._html = String(v); this.children = []; this.value = ''; },
            };
        }
        return porId[id];
    };
    Object.keys(valores || {}).forEach(k => { el(k).value = valores[k]; });
    return {
        porId, el,
        document: {
            body: el('__body'),
            getElementById: (id) => el(id),
            createElement: () => el('__nuevo_' + Math.random()),
            querySelector: () => null,
            querySelectorAll: () => [],
        },
    };
}

function sandbox(dom, extra) {
    const almacen = {};
    const avisos = [];
    const sb = Object.assign({
        console: { log() {}, warn() {}, error() {} },
        document: dom.document,
        localStorage: {
            getItem: (k) => (k in almacen ? almacen[k] : null),
            setItem: (k, v) => { almacen[k] = String(v); },
            removeItem: (k) => { delete almacen[k]; },
        },
        showToast: (t) => avisos.push(String(t)),
        setTimeout: () => 0, clearTimeout() {},
        Promise, JSON, Date, Math, Object, Array, String, Number, RegExp, Error, Set, Map, parseInt,
        Event: function () {},
    }, extra || {});
    sb.window = sb;
    vm.createContext(sb);
    sb._almacen = almacen;
    sb._avisos = avisos;
    return sb;
}

// Los partidos REALES del fixture de v666 (Alevín C del CD DÍA).
const CALENDARIO = [
    { fecha: '2026-09-12', jornada: 1, hora: '11:00', rival: 'Maspalomas',   local: true,  sede: 'Cru. Arinaga' },
    { fecha: '2026-09-18', jornada: 2, hora: '21:00', rival: 'AD Huracán B', local: false, sede: 'Pepe Gonçalvez' },
    { fecha: '2026-09-26', jornada: 3, hora: '11:00', rival: 'San Fernando', local: true,  sede: 'Cru. Arinaga' },
];
const EQUIPO = { clubId: 'cddia', teamId: 'cddia__futurefem__c', category: 'futurefem', subcategory: 'C',
                 etiqueta: 'FUTureFEM C', clubName: 'CD Día' };

// ═══════════════════════════════════════════════════════════════════════════
console.log('\n── PARTE 1 · la plantilla propia se carga sola ──');
// ═══════════════════════════════════════════════════════════════════════════
{
    const dom = nuevoDom({ 'setup-mode': 'f11', 'setup-my-team-role': 'home',
                           'setup-home-name': 'LOCAL', 'setup-away-name': 'VISITANTE' });
    const sb = sandbox(dom);
    vm.runInContext(PERSIST, sb);
    sb.cronosEquipoDelPanel = () => EQUIPO;
    sb.cronosNombreDeFabrica = (n) => /^(local|visitante)$/i.test(String(n || '').trim());
    // syncSetupMode REAL repuebla los equipos guardados: es lo que dejaba el
    // desplegable en «-- Cargar --» (IMG_2761).
    sb.syncSetupMode = () => { vm.runInContext("populateSavedTeams('home'); populateSavedTeams('away');", sb); };

    const E = sb.cronosElegirPlantillaPropia;
    const teams = [
        { name: 'MASPALOMAS',  mode: 'f11', category: 'f11_futurefem' },
        { name: 'FUTUREFEM C', mode: 'f11', category: 'f11_futurefem' },
        { name: 'ALEVÍN C',    mode: 'f7' },
    ];
    ok('1a · elige la que se llama como el equipo («FUTUREFEM C» == «FUTureFEM C»)', E(teams, 'f11', EQUIPO, {}) === 1);
    ok('1b · con sólo la plantilla de un RIVAL no carga ninguna',
       E([{ name: 'MASPALOMAS', mode: 'f11', category: 'f11_futurefem' }], 'f11', EQUIPO, {}) === -1);
    ok('1c · la recordada para el equipo manda',
       E(teams, 'f11', EQUIPO, { cddia__futurefem__c: 'MASPALOMAS' }) === 0);
    ok('1d · la que lleva el nombre del club, si es una sola',
       E([{ name: 'X', mode: 'f11' }, { name: 'CD DÍA FEM', mode: 'f11' }], 'f11', EQUIPO, {}) === 1);
    ok('1e · las de otra modalidad no cuentan', E(teams, 'f7', EQUIPO, {}) === -1);

    sb._almacen.cronos_teams = JSON.stringify(teams);
    const cargo = sb.cronosAutoCargarPlantillaPropia();
    ok('1f · al abrir el panel carga «FUTUREFEM C» en MI lado', cargo === true &&
       dom.el('setup-home-name').value === 'FUTUREFEM C', dom.el('setup-home-name').value);
    ok('1g · 🔑 el desplegable queda en la plantilla, no en «-- Cargar --»',
       String(dom.el('saved-teams-home').value) === '1', 'value=' + dom.el('saved-teams-home').value);
    ok('1h · la carga automática no enseña toast', sb._avisos.length === 0, sb._avisos.join(' | '));
    ok('1i · y queda recordada para el equipo',
       JSON.parse(sb._almacen.cronos_plantilla_propia || '{}').cddia__futurefem__c === 'FUTUREFEM C');

    ok('1j · lo escrito a mano NO se pisa', sb.cronosAutoCargarPlantillaPropia() === false);

    dom.el('setup-my-team-role').value = 'away';
    dom.el('setup-away-name').value = 'VISITANTE';
    sb.cronosAutoCargarPlantillaPropia();
    ok('1k · jugando fuera se carga en la columna VISITANTE',
       dom.el('setup-away-name').value === 'FUTUREFEM C', dom.el('setup-away-name').value);

    // populateSavedTeams conserva lo elegido
    dom.el('saved-teams-home').value = '1';
    vm.runInContext("populateSavedTeams('home')", sb);
    ok('1l · repoblar los equipos guardados conserva la selección', String(dom.el('saved-teams-home').value) === '1');

    // La carrera: se repinta cuando la nube termina
    ok('1m · 🔑 init() repinta el panel al terminar migrateLocalToCloud',
       /migrateLocalToCloud\(\)\.then\(\(\) => \{[\s\S]{0,600}cronosRefrescarPlantillasDelPanel\(\)/.test(APPINIT));
    ok('1n · el oyente en tiempo real también usa la carga automática',
       STORAGE.indexOf('cronosRefrescarPlantillasDelPanel') > 0);
    ok('1o · openSetupModal lanza la carga automática tras repoblar (300 ms)',
       /cronosAutoCargarPlantillaPropia\(\);\s*\}\s*\}, 300\)/.test(SETUP));
}

// ═══════════════════════════════════════════════════════════════════════════
console.log('\n── PARTE 2 · tipo, jornada y localía en la pantalla inicial ──');
// ═══════════════════════════════════════════════════════════════════════════
function montarSetup(valores, extra) {
    const dom = nuevoDom(Object.assign({
        'setup-mode': 'f11', 'setup-my-team-role': 'home',
        'setup-home-name': 'FUTUREFEM C', 'setup-away-name': 'VISITANTE',
        'setup-home-color': '#58a6ff', 'setup-away-color': '#ff5858',
        'setup-home-shorts': '#ffffff', 'setup-away-shorts': '#000000',
        'setup-home-text': '#000000', 'setup-away-text': '#ffffff',
        'match-category': 'f11_futurefem', 'match-subcategory': 'C',
        'setup-match-type': 'liga',
    }, valores || {}));
    const abiertas = [];
    const sb = sandbox(dom, Object.assign({
        _cronosLocalDateKey: () => '2026-09-17',
        _cronosCurrentUser: { uid: 'u1', clubName: 'CD Día' },
        cronosNombreDeFabrica: (n) => /^(local|visitante)$/i.test(String(n || '').trim()),
        cronosNombreCategoria: (c, s) => ({ futurefem: 'FUTureFEM' }[String(c).replace(/^f\d+_/, '')] || c) + (s ? ' ' + s : ''),
        TEAM_NAMES: { home: 'LOCAL', away: 'VISITANTE' },
        COLORS: { home: {}, away: {} },
        currentMode: 'f11', analyzeAway: false, selectedFormationOnStart: '',
        half1MaxTime: 0, half2MaxTime: 0,
        openConvocationModal: () => abiertas.push(1),
    }, extra || {}));
    vm.runInContext(SETUP, sb);
    sb.cronosEquipoDelPanel = () => EQUIPO;
    sb.cronosNombreRival = () => {
        const lado = sb._userTeamRole === 'away' ? 'home' : 'away';
        const n = sb.TEAM_NAMES[lado] || '';
        return /^(local|visitante)$/i.test(n) ? '' : n;
    };
    sb._abiertas = abiertas;
    return { dom, sb };
}

{
    const { dom, sb } = montarSetup();
    ok('2a · la jornada por defecto es la más cercana desde hoy (J2, 18/09)',
       vm.runInContext('_setupIndicePartido({}, ' + JSON.stringify(CALENDARIO) + ')', sb) === 1);
    ok('2b · una jornada fijada por el entrenador se respeta',
       vm.runInContext('_setupIndicePartido({fecha:"2026-09-26",hora:"11:00"}, ' + JSON.stringify(CALENDARIO) + ')', sb) === 2);

    // Liga con calendario: J2 se juega FUERA
    sb._setupCal = { teamId: EQUIPO.teamId, estado: 'ok', lista: CALENDARIO };
    vm.runInContext('_setupEstadoDatos().tipo = "liga"; _setupPintarDatosPartido();', sb);
    ok('2c · 🔑 la jornada fija la localía: J2 → VISITANTE',
       dom.el('setup-my-team-role').value === 'away', dom.el('setup-my-team-role').value);
    ok('2d · mi equipo se muda a la columna VISITANTE con sus colores',
       dom.el('setup-away-name').value === 'FUTUREFEM C' && dom.el('setup-away-color').value === '#58a6ff',
       dom.el('setup-away-name').value + ' ' + dom.el('setup-away-color').value);
    ok('2e · el rival del calendario va a la columna LOCAL',
       dom.el('setup-home-name').value === 'AD HURACÁN B', dom.el('setup-home-name').value);
    ok('2f · el interruptor 🏠/✈️ queda bloqueado en Liga',
       dom.el('role-btn-home').disabled === true && dom.el('role-btn-away').disabled === true);
    ok('2g · el resumen dice FUERA y el rival',
       /FUERA/.test(dom.el('setup-datos-resumen').innerHTML) && /AD Huracán B/.test(dom.el('setup-datos-resumen').innerHTML));

    vm.runInContext('_setupElegirLocalia("home")', sb);
    ok('2h · pulsar LOCAL con el calendario mandando no cambia nada',
       dom.el('setup-my-team-role').value === 'away' && sb._avisos.some(a => /calendario oficial/.test(a)));

    vm.runInContext('_setupElegirPartidoCal("2")', sb);
    ok('2i · elegir J3 (en casa) devuelve mi equipo a LOCAL y pone al nuevo rival',
       dom.el('setup-my-team-role').value === 'home' && dom.el('setup-home-name').value === 'FUTUREFEM C' &&
       dom.el('setup-away-name').value === 'SAN FERNANDO',
       dom.el('setup-home-name').value + ' / ' + dom.el('setup-away-name').value);

    vm.runInContext('_setupCambiarTipoPartido("amistoso")', sb);
    ok('2j · en Amistoso la localía vuelve a ser libre',
       dom.el('role-btn-home').disabled === false && dom.el('setup-cal-box').style.display === 'none');
    vm.runInContext('_setupElegirLocalia("away")', sb);
    ok('2k · y al cambiarla a mano, mi equipo también cambia de columna',
       dom.el('setup-away-name').value === 'FUTUREFEM C' && dom.el('setup-my-team-role').value === 'away');
}

{
    // Rótulos de fábrica no viajan de columna
    const { dom, sb } = montarSetup({ 'setup-home-name': 'LOCAL', 'setup-away-name': 'VISITANTE' });
    vm.runInContext('_setupElegirLocalia("away")', sb);
    ok('2l · un rótulo de fábrica no se muda («LOCAL» sigue en LOCAL)',
       dom.el('setup-home-name').value === 'LOCAL' && dom.el('setup-away-name').value === 'VISITANTE');
}

{
    // confirmSetup en Liga: re-impone la jornada, pasa los datos a la convocatoria
    const { dom, sb } = montarSetup({ 'setup-home-name': 'LOCAL' });
    sb._setupCal = { teamId: EQUIPO.teamId, estado: 'ok', lista: CALENDARIO };
    vm.runInContext('_setupEstadoDatos().tipo = "liga"; _setupEstadoDatos().fecha = "2026-09-18"; _setupEstadoDatos().hora = "21:00";', sb);
    dom.el('setup-my-team-role').value = 'home';     // DOM manipulado: dice LOCAL
    vm.runInContext('confirmSetup()', sb);
    ok('2m · 🔑 confirmSetup re-impone la localía del calendario aunque el DOM diga LOCAL',
       sb._userTeamRole === 'away', sb._userTeamRole);
    ok('2n · y abre la convocatoria', sb._abiertas.length === 1);
    const conv = JSON.parse(sb._almacen.cronos_conv_data || '{}');
    ok('2o · la convocatoria hereda tipo, fecha, hora, campo, rival y jornada',
       conv.type === 'liga' && conv.date === '2026-09-18' && conv.time === '21:00' &&
       conv.venue === 'Pepe Gonçalvez' && conv.rival === 'AD Huracán B' && conv.jornada === '2',
       JSON.stringify(conv));
    ok('2p · queda marcado como decidido en la pantalla inicial (bloquea la convocatoria)',
       !!(sb._cronosDatosPartido && sb._cronosDatosPartido.confirmado && sb._cronosDatosPartido.confirmado.partido));
}

{
    // confirmSetup espera al calendario… con tope
    const { sb } = montarSetup();
    sb._setupCal = { teamId: EQUIPO.teamId, estado: 'cargando', lista: [], desde: Date.now() };
    vm.runInContext('_setupEstadoDatos().tipo = "liga"', sb);
    vm.runInContext('confirmSetup()', sb);
    ok('2q · con el calendario leyéndose no arranca (la localía aún no está decidida)', sb._abiertas.length === 0);
    sb._setupCal.desde = Date.now() - 9000;
    vm.runInContext('confirmSetup()', sb);
    ok('2r · pero pasados 8 s arranca igual: sin cobertura no se bloquea el partido', sb._abiertas.length === 1);
}

{
    // Amistoso: no arrastra el rival ni la fecha de la convocatoria anterior
    const { sb } = montarSetup();
    sb._almacen.cronos_conv_data = JSON.stringify({ type: 'liga', rival: 'Viejo Rival', date: '2026-09-01', venue: 'Campo viejo' });
    sb._setupCal = { teamId: EQUIPO.teamId, estado: 'ok', lista: CALENDARIO };
    vm.runInContext('_setupEstadoDatos().tipo = "amistoso"', sb);
    sb.document.getElementById('setup-match-type').value = 'amistoso';
    vm.runInContext('confirmSetup()', sb);
    const conv = JSON.parse(sb._almacen.cronos_conv_data);
    ok('2s · amistoso sin rival: no hereda «Viejo Rival» ni la fecha pasada',
       conv.type === 'amistoso' && conv.rival === '' && conv.date === '2026-09-17' && conv.venue === '',
       JSON.stringify(conv));
}

ok('2t · el bloque DATOS DEL PARTIDO va ANTES de las columnas de equipos',
   SETUP.indexOf('id="setup-datos-partido"') > 0 &&
   SETUP.indexOf('id="setup-datos-partido"') < SETUP.indexOf('CUADRICULA SIMÉTRICA DE EQUIPOS (LOCAL / VISITANTE) -->'));
ok('2u · los botones LOCAL/VISITA pasan por _setupElegirLocalia',
   /id="role-btn-home"\s*onclick="_setupElegirLocalia\('home'\)"/.test(SETUP) &&
   /id="role-btn-away"\s*onclick="_setupElegirLocalia\('away'\)"/.test(SETUP));

// ═══════════════════════════════════════════════════════════════════════════
console.log('\n── PARTE 3 · la convocatoria no puede contradecirlo ──');
// ═══════════════════════════════════════════════════════════════════════════
ok('3a · el tipo de partido sale bloqueado si lo decidió la pantalla inicial',
   /<select id="conv-type"[^>]*\$\{_convBloq\}>/.test(IMPORT));
ok('3b · rival y jornada, de sólo lectura con jornada del calendario',
   /id="conv-rival"[\s\S]{0,120}\$\{_convCalFijo \? ' readonly/.test(IMPORT) &&
   /id="conv-jornada"[\s\S]{0,120}\$\{_convCalFijo \? ' readonly/.test(IMPORT));
ok('3c · el desplegable del calendario enseña la jornada elegida y queda fijo',
   /if \(_convCalFijo\) \{[\s\S]{0,500}selCal\.disabled = true/.test(IMPORT));
ok('3d · los datos se consumen al arrancar, en LAS DOS vías al partido',
   (IMPORT.match(/window\._cronosDatosPartido = null/g) || []).length >= 2);

// ═══════════════════════════════════════════════════════════════════════════
console.log('\n── PARTE 4 · nombres reales y categoría, en el directo y en el visor ──');
// ═══════════════════════════════════════════════════════════════════════════
{
    const { dom, sb } = montarSetup({ 'setup-home-name': 'LOCAL', 'setup-away-name': 'MASPALOMAS', 'setup-match-type': 'amistoso' });
    vm.runInContext('_setupEstadoDatos().tipo = "amistoso"', sb);
    vm.runInContext('confirmSetup()', sb);
    ok('4a · 🔑 sin plantilla, mi equipo sale con el nombre del club, no «LOCAL»',
       sb.TEAM_NAMES.home === 'CD DÍA' && dom.el('team-a-name').textContent === 'CD DÍA',
       sb.TEAM_NAMES.home);
    ok('4b · el rival escrito se respeta', sb.TEAM_NAMES.away === 'MASPALOMAS');

    sb._currentMatchCategory = 'f11_futurefem';
    sb._currentMatchSubcategory = 'C';
    ok('4c · la etiqueta de categoría del partido es «FUTureFEM C»',
       sb.cronosEtiquetaCategoriaPartido() === 'FUTureFEM C', sb.cronosEtiquetaCategoriaPartido());
}
{
    const sb = sandbox(nuevoDom(), {});
    sb.cronosEquipoDelPanel = () => ({ etiqueta: 'FUTureFEM C', clubName: '' });
    vm.runInContext(SETUP.slice(SETUP.indexOf('window.cronosNombrePropioPorDefecto'),
                                SETUP.indexOf('function _setupHoy()')), sb);
    ok('4d · sin club conocido, el nombre del equipo («FUTUREFEM C»)', sb.cronosNombrePropioPorDefecto() === 'FUTUREFEM C');
}
ok('4e · la cabecera del entrenador tiene el rótulo de categoría',
   INDEX.indexOf('id="match-team-label"') > 0);
ok('4f · updateMasterUI lo pinta en todos los caminos (nuevo, recuperar, recarga)',
   /match-team-label[\s\S]{0,200}cronosEtiquetaCategoriaPartido/.test(CORE));

{
    const ini = LIVE.indexOf('function _liveNombreEquipo(');
    const fin = LIVE.indexOf('function renderMatch(');
    const sb = { };
    vm.createContext(sb);
    vm.runInContext(LIVE.slice(ini, fin), sb);
    const N = sb._liveNombreEquipo;
    const doc = { myTeamRole: 'home', clubName: 'CD Día',
                  homeTeam: { name: 'LOCAL' }, awayTeam: { name: 'VISITANTE' } };
    ok('4g · visor: un documento viejo con «LOCAL» rotula mi lado con el club', N(doc, 'home') === 'CD DÍA');
    ok('4h · visor: el rival sin nombre no se inventa', N(doc, 'away') === 'VISITANTE');
    ok('4i · visor: jugando fuera, el club va en el lado visitante',
       N(Object.assign({}, doc, { myTeamRole: 'away' }), 'away') === 'CD DÍA' &&
       N(Object.assign({}, doc, { myTeamRole: 'away' }), 'home') === 'LOCAL');
    ok('4j · visor: los nombres reales no se tocan',
       N({ homeTeam: { name: 'AD HURACÁN B' }, awayTeam: { name: 'FUTUREFEM C' }, clubName: 'CD Día' }, 'home') === 'AD HURACÁN B');
}
ok('4k · el marcador del visor usa los nombres reales',
   /sb-home-name'\)\.textContent\s*= _nomLive \? _nomLive\(data, 'home'\)/.test(LIVE));
ok('4l · bajo el reloj del visor va la categoría y subcategoría',
   /_liveCategoriaEtiqueta\(data\)[\s\S]{0,200}live-mode/.test(LIVE));
ok('4m · la barra de sucesos y las tarjetas tampoco dicen «LOCAL»/«VISITANTE» a pelo',
   LIVE.indexOf("escapeHtml(m.homeTeam?.name||'LOCAL')") < 0 &&
   /const home = _nom \? _nom\(data, 'home'\)/.test(LIVE));

console.log('\n' + (total - fallos) + '/' + total + ' aserciones OK');
process.exit(fallos ? 1 : 0);

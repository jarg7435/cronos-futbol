// ─────────────────────────────────────────────────────────────────────────
// test_live_back_to_list.js  ·  el "← VOLVER" del visor devuelve al panel
// general de Partidos en Vivo (v439)
//
// Peticion del autor: al entrar en el detalle de un partido y pulsar el
// "← VOLVER" de la cabecera hay que aparecer en el panel general de partidos
// en vivo. Y respetando el rol:
//   · el PADRE vuelve a su vista asignada (entra por un enlace directo a UN
//     partido desde su panel; no tiene entre que elegir);
//   · director, coordinador y entrenador pueden tener VARIOS partidos del club
//     a la vez y necesitan el listado para alternar entre ellos.
//
// ESTE GUARD NO SE LIMITA A MIRAR EL FUENTE: extrae el bloque de live.html y
// lo EJECUTA contra un DOM y unos roles fabricados, comprobando a donde va.
//
// LO QUE PROTEGE, y por que cada cosa se rompe sola si nadie la vigila:
//
//  A · EL DEFECTO DE FONDO NO ESTABA EN EL BOTON, SINO EN EL LISTENER. El
//      onSnapshot del documento del partido seguia vivo despues de pintar la
//      lista, y su callback llama a renderMatch, que apaga #history-view y
//      enciende el campo. Como el entrenador reescribe el documento cada ~5 s,
//      la lista duraba en pantalla hasta el siguiente latido y el usuario
//      volvia a aparecer DENTRO del partido sin tocar nada. Le pasaba igual al
//      boton "EN VIVO" de la cabecera, que ya llamaba a showLiveNow.
//      🔑 Cablear el boton sin soltar el listener no arregla nada: es la misma
//      familia que v402-v405 (mirar las CAPAS, no el handler).
//
//  B · EL ROL DECIDE EL DESTINO. Meter al padre en el listado general le
//      enseñaria partidos de equipos que no son el de su hijo.
//
//  C · SOLO DESDE DENTRO DE UN PARTIDO. Estando ya en el listado, VOLVER
//      conserva su funcion de siempre —salir del visor—; si no, seria un boton
//      que no hace nada justo en la pantalla donde mas se mira.
//
//  D · NO SE TOCA currentMatchId al soltar el partido: el watcher de fondo
//      filtra los avisos por esa variable (v274), asi que borrarla dejaria al
//      director sin avisos del partido que acaba de estar viendo.
// ─────────────────────────────────────────────────────────────────────────
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.join(__dirname, '..');
let fail = 0, pass = 0;
const ok = (name, cond, extra) => {
    if (cond) { pass++; console.log('PASS ' + name); }
    else { fail++; console.log('FAIL ' + name); if (extra !== undefined) console.log('       ' + extra); }
};

const LIVE = fs.readFileSync(path.join(ROOT, 'live.html'), 'utf8');

console.log('── "← VOLVER" al panel general de Partidos en Vivo (v439) ──\n');

// ═══════════ El bloque se extrae y se EJECUTA ═══════════
const ini = LIVE.indexOf('const _LIVE_ROLES_MULTIPARTIDO');
const fin = LIVE.indexOf('// ── fin del bloque VOLVER (v439)');
ok('0a · el bloque VOLVER sigue existiendo en live.html', ini !== -1 && fin > ini);
if (ini === -1 || fin <= ini) {
    console.log('\n' + pass + ' PASS / ' + (fail + 1) + ' FAIL');
    process.exit(1);
}
const BLOQUE = LIVE.slice(ini, fin);

// Un visor de mentira: el estado justo que lee el bloque.
//   vista: 'partido' | 'listado'
function montar(rol, vista, opts) {
    const o = opts || {};
    const traza = { showLiveNow: 0, close: 0, focus: 0, href: null, url: null };
    const historyView = { style: { display: vista === 'listado' ? 'flex' : 'none' } };
    const win = {
        opener: o.sinOpener ? null : { closed: false, focus: () => { traza.focus++; } },
        close: () => { traza.close++; },
        location: { get href() { return traza.href; }, set href(v) { traza.href = v; } },
    };
    const sandbox = {
        window: win,
        userData: rol === null ? null : { role: rol, uid: 'u1' },
        currentMatchId: ('matchId' in o) ? o.matchId : 'm1',
        document: { getElementById: (id) => (id === 'history-view' ? historyView : null) },
        history: { pushState: (a, b, url) => { traza.url = url; } },
        location: { pathname: '/live.html' },
        showLiveNow: () => { traza.showLiveNow++; },
        console: { log() {}, warn() {} },
    };
    vm.createContext(sandbox);
    vm.runInContext(BLOQUE, sandbox);
    return { traza, pulsar: () => win.backToMatch(), sandbox };
}

// ═══════════ PARTE 1 · el cuerpo tecnico vuelve al LISTADO ═══════════
console.log('\n── PARTE 1 · cuerpo tecnico: al panel general ──');
{
    ['user', 'director', 'coordinator', 'club_admin', 'superadmin', 'admin'].forEach(rol => {
        const v = montar(rol, 'partido');
        v.pulsar();
        ok('1 · [' + rol + '] vuelve al listado de Partidos en Vivo',
           v.traza.showLiveNow === 1 && v.traza.close === 0 && v.traza.href === null,
           JSON.stringify(v.traza));
    });

    const v = montar('director', 'partido');
    v.pulsar();
    ok('1g · 🔑 y NO cierra la pestaña del visor (podria haber otros partidos que ver)',
       v.traza.close === 0 && v.traza.focus === 0);
    ok('1h · se limpia el ?match= de la URL',
       v.traza.url === '/live.html',
       'sin esto, recargar devolveria al partido del que se acaba de salir');
}

// ═══════════ PARTE 2 · el padre vuelve a SU vista ═══════════
console.log('\n── PARTE 2 · el padre, a su vista asignada ──');
{
    const v = montar('parent', 'partido');
    v.pulsar();
    ok('2a · [DEFECTO B] el padre NO acaba en el listado general del club',
       v.traza.showLiveNow === 0,
       'veria partidos de equipos que no son el de su hijo');
    ok('2b · vuelve a la ventana desde la que abrio el visor',
       v.traza.focus === 1 && v.traza.close === 1);

    const sinOpener = montar('parent', 'partido', { sinOpener: true });
    sinOpener.pulsar();
    ok('2c · y si nadie la abrio, cae a la app (index.html)',
       sinOpener.traza.href === 'index.html' && sinOpener.traza.close === 0);

    const desconocido = montar('rol_que_no_existe', 'partido');
    desconocido.pulsar();
    ok('2d · un rol desconocido conserva el comportamiento de siempre, no el nuevo',
       desconocido.traza.showLiveNow === 0 && desconocido.traza.close === 1);

    const sinUser = montar(null, 'partido');
    sinUser.pulsar();
    ok('2e · sin userData tampoco revienta', sinUser.traza.close === 1);
}

// ═══════════ PARTE 3 · solo desde DENTRO de un partido ═══════════
console.log('\n── PARTE 3 · desde el listado, la salida de siempre ──');
{
    const v = montar('director', 'listado');
    v.pulsar();
    ok('3a · [DEFECTO C] estando YA en el listado, VOLVER sale del visor',
       v.traza.showLiveNow === 0 && v.traza.close === 1,
       'repintar la misma pantalla seria un boton que no hace nada');

    const sinPartido = montar('director', 'partido', { matchId: null });
    sinPartido.pulsar();
    ok('3b · sin partido cargado tampoco intenta volver a ningun sitio',
       sinPartido.traza.showLiveNow === 0 && sinPartido.traza.close === 1);
}

// ═══════════ PARTE 4 · el listener que tapaba la lista ═══════════
console.log('\n── PARTE 4 · soltar el partido al salir de el ──');
{
    const iniS = LIVE.indexOf('function _soltarPartidoVisible()');
    const finS = LIVE.indexOf('// Cancela TODOS los listeners de fondo');
    ok('4a · existe _soltarPartidoVisible', iniS !== -1 && finS > iniS);

    const s = {
        unsubscribeMatch: null, timerInterval: null,
        clearInterval: (t) => { s.limpiados.push(t); },
        limpiados: [], cancelado: 0,
        currentMatchId: 'm1',
    };
    vm.createContext(s);
    vm.runInContext(LIVE.slice(iniS, finS), s);
    s.unsubscribeMatch = () => { s.cancelado++; };
    s.timerInterval = 42;
    s.soltar = () => {};
    vm.runInContext('_soltarPartidoVisible()', s);

    ok('4b · [DEFECTO A] 🔑 cancela el onSnapshot del partido',
       s.cancelado === 1 && s.unsubscribeMatch === null,
       'con el vivo, el siguiente latido llama a renderMatch y tapa la lista');
    ok('4c · y para el cronometro del detalle',
       s.limpiados.indexOf(42) !== -1 && s.timerInterval === null);
    ok('4d · [DEFECTO D] 🔑 NO borra currentMatchId',
       s.currentMatchId === 'm1',
       'el watcher de fondo filtra los avisos por esa variable (v274): borrarla deja al director sin avisos');
    vm.runInContext('_soltarPartidoVisible()', s);
    ok('4e · es idempotente (llamarlo dos veces no revienta)', s.cancelado === 1);

    // Y que los DOS caminos de vuelta lo usan.
    const cuerpoLiveNow = LIVE.slice(LIVE.indexOf('window.showLiveNow = async function'),
                                     LIVE.indexOf('window.showLiveNow = async function') + 900);
    ok('4f · showLiveNow lo llama ANTES de pintar la lista',
       /_soltarPartidoVisible\(\);/.test(cuerpoLiveNow) &&
       cuerpoLiveNow.indexOf('_soltarPartidoVisible()') < cuerpoLiveNow.indexOf("history-view"),
       cuerpoLiveNow.slice(0, 400));
    const cuerpoHist = LIVE.slice(LIVE.indexOf('window.showHistory = async function'),
                                  LIVE.indexOf('window.showHistory = async function') + 900);
    ok('4g · y showHistory tambien (el historial lo tapaba igual)',
       /_soltarPartidoVisible\(\);/.test(cuerpoHist),
       cuerpoHist.slice(0, 300));

    // Simetrico: al entrar en un partido se sueltan los listeners del listado.
    const cuerpoLoad = LIVE.slice(LIVE.indexOf('window.loadMatch = function(matchId)'),
                                  LIVE.indexOf('window.loadMatch = function(matchId)') + 1600);
    ok('4h · y al ENTRAR en un partido se sueltan los del listado',
       /_liveListUnsubscribe\(\); _liveListUnsubscribe = null;/.test(cuerpoLoad) &&
       /clearInterval\(_liveListTimerInterval\)/.test(cuerpoLoad),
       'si no, el listado invisible se repinta cada 5 s y su reloj late cada segundo');
}

// ═══════════ PARTE 5 · el boton sigue siendo el mismo ═══════════
console.log('\n── PARTE 5 · la cabecera no cambia ──');
{
    const cabecera = (LIVE.match(/<header id="live-header"[\s\S]*?<\/header>/) || [''])[0]
        .replace(/<!--[\s\S]*?-->/g, '');
    ok('5a · el boton de la cabecera sigue llamando a backToMatch',
       /id="btn-back-to-match" onclick="backToMatch\(\)"/.test(cabecera));
    ok('5b · y sigue diciendo "← VOLVER"', /←\s*VOLVER/.test(cabecera));
    ok('5c · hay UNA sola definicion de backToMatch',
       (LIVE.match(/window\.backToMatch\s*=/g) || []).length === 1,
       'dos definiciones y gana la ultima cargada: el bug clasico de este repo');
    ok('5d · el badge "EN VIVO" tambien lleva al listado (misma cura)',
       /<button id="live-badge" onclick="showLiveNow\(\)"/.test(cabecera));
}

// ═══════ PARTE 6 · entrar y salir del listado MUCHAS veces ═══════
// Ahora VOLVER trae aqui, asi que showLiveNow se repinta muchas mas veces que
// antes. Lo que se acumule en cada repintado se nota.
console.log('\n── PARTE 6 · repintar el listado no acumula basura ──');
{
    const cuerpo = LIVE.slice(LIVE.indexOf('window.showLiveNow = async function'),
                              LIVE.indexOf('const listEl = document.getElementById(\'history-list\')'));
    ok('6a · el filtro de club del SuperAdmin tiene identidad',
       /filterDiv\.id = 'live-club-filter'/.test(cuerpo));
    ok('6b · 🔑 y el de la visita anterior se RETIRA antes de insertar el nuevo',
       /getElementById\('live-club-filter'\)[\s\S]{0,160}\.remove\(\)/.test(cuerpo) &&
       cuerpo.indexOf("getElementById('live-club-filter')") < cuerpo.indexOf("filterDiv.id = 'live-club-filter'"),
       'se inserta en el padre de #history-header, que no se vacia al repintar: se apilaban desplegables');
}

console.log('\n' + pass + ' PASS / ' + fail + ' FAIL');
process.exit(fail === 0 ? 0 : 1);

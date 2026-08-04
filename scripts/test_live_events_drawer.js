// ─────────────────────────────────────────────────────────────────────────
// test_live_events_drawer.js · los sucesos viven en el cajón de SU partido
// (v440)
//
// Petición del autor: en el panel general de Partidos en Vivo seguían saliendo
// una barra flotante de "HISTORIAL" al pie de la pantalla y avisos emergentes,
// los dos GLOBALES. Con varios partidos simultáneos no se sabía de cuál
// hablaban. Se retiran ambos y los sucesos quedan EXCLUSIVAMENTE dentro del
// cajón/tarjeta del partido al que pertenecen:
//   · en el listado → el mini-feed de cada tarjeta (test_live_card_feed.js)
//   · en el detalle → el cajón dentro del banquillo (esto)
//
// LO QUE PROTEGE, y por qué cada cosa se rompe sola si nadie la vigila:
//
//  A · LA FORMA, NO EL ID. La lección de v405: el autor reportó el mismo
//      síntoma cuatro veces sobre botones distintos y cada vez se arregló uno,
//      cuando era UN PATRÓN. Aquí se prohíbe la FORMA —nada anclado al pie de
//      la pantalla por encima de todo— en vez de un id concreto, para que el
//      siguiente que se añada dé rojo antes de llegar a producción.
//
//  B · EL MOTOR NO PUEDE DEPENDER DEL CONTENEDOR QUE SE FUE. Las dos vías que
//      alimentan la lista comprobaban `#match-events-panel` y salían por la
//      puerta de atrás si no existía. Con el panel retirado, ese `return`
//      dejaría el cajón VACÍO PARA SIEMPRE y sin un solo error. Por eso aquí no
//      se lee el fuente: se EJECUTA el módulo con un DOM que no tiene panel.
//
//  C · EL DEDUP SIGUE SIENDO EL DE v424. Es lo único que impide que un gol
//      salga dos veces, y lo alimentan dos escritores sobre el mismo snapshot.
//
//  D · RETIRAR EL AVISO NO ES QUEDARSE SIN AVISAR. El suceso se sigue
//      anunciando con destello, sonido y vibración —tienen su propio mando y no
//      compiten por el sitio en pantalla—. Si un refactor se llevara eso por
//      delante, el entrenador dejaría de enterarse sin mirar.
// ─────────────────────────────────────────────────────────────────────────
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.join(__dirname, '..');
let fail = 0, pass = 0;
const ok = (name, cond, extra) => {
    if (cond) { pass++; console.log('PASS ' + name); }
    else { fail++; console.log('FAIL ' + name); if (extra !== undefined) console.log('       ' + String(extra).slice(0, 240)); }
};

const LIVE = fs.readFileSync(path.join(ROOT, 'live.html'), 'utf8').replace(/\r\n/g, '\n');
// 🔑 Los comentarios de este proyecto CITAN lo que se acaba de retirar (aquí,
// tres veces). Un censo sobre el fuente crudo daría rojo midiendo comentarios.
const SIN_COM = LIVE
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n').map(l => l.replace(/^\s*\/\/.*$/, '')).join('\n');

console.log('── los sucesos, en el cajón de su partido (v440) ──\n');

// ═══════ PARTE 0 · el fichero parsea ═══════
// Primero de todo: un guard de regex NO puede ver un fichero que no compila, y
// este proyecto ya se dejó un panel entero muerto por un backtick (v400).
console.log('── PARTE 0 · el módulo sigue parseando ──');
const MODULO = (LIVE.match(/<script type="module">([\s\S]*?)<\/script>/) || [, ''])[1];
{
    let e = null;
    try {
        new vm.Script(MODULO
            .replace(/^\s*import\s[^;]*;?$/gm, '')
            .replace(/import\s*{[^}]*}\s*from\s*['"][^'"]*['"];/g, ''));
    } catch (err) { e = err.message; }
    ok('0a · live.html compila tras retirar la barra y los avisos', e === null, e);
}

// ═══════ PARTE 1 · [DEFECTO A] nada anclado al pie de la pantalla ═══════
console.log('\n── PARTE 1 · la FORMA prohibida: barras globales al pie ──');
{
    // Se busca la forma en los DOS sitios donde puede aparecer: reglas de CSS y
    // atributos style="" en el marcado. Un bloque cuenta si declara a la vez
    // `position: fixed` y un anclaje al borde inferior.
    const sospechosos = [];
    // 1 · reglas de CSS  (selector { ... })
    const css = (SIN_COM.match(/<style>([\s\S]*?)<\/style>/) || [, ''])[1];
    const reRegla = /([^{}]+)\{([^{}]*)\}/g;
    let m;
    while ((m = reRegla.exec(css))) {
        const cuerpo = m[2];
        if (/position:\s*fixed/.test(cuerpo) && /bottom:\s*0/.test(cuerpo)) {
            sospechosos.push('css ' + m[1].trim().slice(0, 60));
        }
    }
    // 2 · estilos en línea del marcado
    const reInline = /style="([^"]*)"/g;
    while ((m = reInline.exec(SIN_COM))) {
        const v = m[1];
        if (/position:\s*fixed/.test(v) && /bottom:\s*0/.test(v)) {
            sospechosos.push('inline ' + v.replace(/\s+/g, ' ').slice(0, 60));
        }
    }
    ok('1a · 🔑 NADA en el visor se ancla al pie de la pantalla por encima de todo',
       sospechosos.length === 0, sospechosos.join(' || '));

    // Y el caso concreto que se retiró, por su nombre.
    ok('1b · no queda la barra "HISTORIAL" (#match-events-panel)',
       !/match-events-panel/.test(SIN_COM),
       (SIN_COM.match(/[^\n]*match-events-panel[^\n]*/) || ['(limpio)'])[0]);
    // v444: la pila de avisos VOLVIÓ (el autor la pidió de vuelta). Lo que se
    // fija aquí es lo único que importaba de ella para esta parte: que va
    // ARRIBA, a la altura del marcador, y no anclada al pie como la barra
    // retirada. Su comportamiento lo cubre test_live_view_cleanup PARTE 2.
    ok('1c · la pila de avisos vuelve, pero ARRIBA y no anclada al pie',
       /#event-toast-stack\s*\{[^}]*top:\s*var\(--toast-top/.test(SIN_COM) &&
       !/#event-toast-stack\s*\{[^}]*bottom:\s*0/.test(SIN_COM),
       (SIN_COM.match(/#event-toast-stack\s*\{[^}]*/) || ['(no está)'])[0].slice(0, 90));
    ok('1d · ni el z-index de guerra que la ponía por encima de todo',
       !/z-index:\s*9998/.test(SIN_COM));

    // Lo que SÍ puede seguir fijo, para que 1a no se lea como "nada fijo":
    // superposiciones a pantalla completa y el aviso de nueva versión, que va
    // ARRIBA. Se declaran para que la diferencia sea deliberada.
    ok('1e · lo que sigue fijo es a pantalla completa o va arriba (declarado)',
       /#event-flash\s*\{[^}]*position:\s*fixed[^}]*inset:\s*0/.test(SIN_COM) &&
       /id="update-banner"[\s\S]{0,200}position:\s*fixed;\s*top:\s*0/.test(SIN_COM));
}

// ═══════ PARTE 2 · la barra de sucesos, legible y sin tapar el campo ═══════
// ⚠️ PARTE REESCRITA EN v442. Fijaba que la lista viviera DENTRO del <aside>
// del banquillo (v440). Medido contra la app real por el autor: en una columna
// de 200px las líneas se parten y no se entiende nada. Vuelve a ser una barra
// inferior a lo ancho. Lo que se conserva de la intención original —y es lo que
// de verdad importaba— es que NO sea global: se enciende y se apaga con la
// vista de partido, y dice de qué partido es.
console.log('\n── PARTE 2 · la barra inferior, legible y en el flujo ──');
{
    const aside = (SIN_COM.match(/<aside id="bench-panel">([\s\S]*?)<\/aside>/) || [, ''])[1];
    ok('2a · el banquillo sigue teniendo sus dos secciones de suplentes',
       /id="bench-home"/.test(aside) && /id="bench-away"/.test(aside));
    ok('2b · 🔑 y YA NO lleva dentro la lista de sucesos (era ilegible a 200px)',
       !/match-events/.test(aside),
       'el defecto que reportó el autor: comprimida en la columna lateral');
    ok('2b2 · 🔑 la barra va DESPUÉS de #live-main, en el flujo de la columna',
       /<\/div>\s*<div id="match-events-bar"/.test(SIN_COM.slice(SIN_COM.indexOf('id="live-main"'))),
       'en el flujo no puede tapar el campo: #live-main es flex:1 y se reajusta');
    ok('2b3 · 🔑 y NO flota (sin position:fixed ni anclaje al pie)',
       !/#match-events-bar\s*\{[^}]*position:\s*fixed/.test(SIN_COM) &&
       !/id="match-events-bar"[^>]*position:\s*fixed/.test(SIN_COM));
    ok('2c · con su contador y su botón de limpiar',
       /id="match-events-count"/.test(SIN_COM) && /id="match-events-clear"/.test(SIN_COM));
    // ⚠️ SOBRE LA REGLA BASE, NO SOBRE CUALQUIERA. Hay una segunda regla de
    // #match-events-list dentro del @media de móvil apaisado, y buscar en todo
    // el CSS la encontraba a ELLA: quitarle el tope a la regla base pasaba
    // desapercibido (lo destapó la mutación M10 del red-check, verde con el
    // defecto puesto). Se quitan los bloques @media y se mide lo que queda.
    const cssBase = (() => {
        let t = (SIN_COM.match(/<style>([\s\S]*?)<\/style>/) || [, ''])[1];
        let out = '', i = 0;
        while (i < t.length) {
            const m = t.indexOf('@media', i);
            if (m === -1) { out += t.slice(i); break; }
            out += t.slice(i, m);
            let j = t.indexOf('{', m), n = 0;
            for (; j < t.length; j++) {
                if (t[j] === '{') n++;
                else if (t[j] === '}') { n--; if (n === 0) { j++; break; } }
            }
            i = j;
        }
        return out;
    })();
    // ⚠️ `height:` ANCLADO AL INICIO DE DECLARACIÓN. Sin el `[;{]` delante, la
    // regex casaba con `line-height: 1.5` y daba por bueno un alto que ya no
    // existía: la mutación que borraba `height: 116px` salía VERDE.
    ok('2d · 🔑 la lista lleva alto FIJO y scroll propio',
       /#match-events-list\s*\{(?:[^}]*;)?\s*height:\s*\d/.test(cssBase) &&
       /#match-events-list\s*\{[^}]*overflow-y:\s*auto/.test(cssBase),
       'un alto que creciera con el número de sucesos le iría comiendo el campo');
    ok('2d2 · y la medida se hace sobre la regla BASE, no sobre la de un @media',
       !/@media/.test(cssBase) && cssBase.length < SIN_COM.length,
       'con el CSS entero, la regla de móvil apaisado tapaba el defecto');
    ok('2e · y un estado vacío, para que no parezca roto antes del primer suceso',
       /#match-events-list:empty::after/.test(SIN_COM));

    // 🔑 LEGIBILIDAD, que es lo que reportó el autor. Se mide, no se argumenta:
    // el texto de la lista tiene que ser claramente mayor que el de la columna
    // lateral de la que viene (0.72rem) y las líneas no pueden recortarse.
    const tamListaBase = (cssBase.match(/#match-events-list\s*\{[^}]*font-size:\s*([\d.]+)rem/) || [, '0'])[1];
    ok('2g · 🔑 la letra de los sucesos es legible (≥ 0.8rem, era 0.72 en la columna)',
       parseFloat(tamListaBase) >= 0.8, tamListaBase + 'rem');
    ok('2g2 · y las filas no recortan el texto con puntos suspensivos',
       !/function _filaSucesoHtml[\s\S]{0,900}?text-overflow:\s*ellipsis/.test(SIN_COM),
       'recortar aquí sería el mismo defecto que en la columna lateral');
    // ⚠️ Se cuentan los USOS, no las apariciones: la declaración lleva los
    // mismos nombres de parámetro y se colaba en el recuento. Cuarta vez que
    // aparece esta familia (`openPastMatchesModal` y el `===` del typeof).
    ok('2g3 · 🔑 la fila la construye UN solo sitio, y lo usan las DOS vías',
       (SIN_COM.match(/function _filaSucesoHtml/g) || []).length === 1 &&
       (SIN_COM.match(/row\.innerHTML = _filaSucesoHtml\(/g) || []).length === 2,
       'dos copias del mismo render acaban divergiendo: es el bug que arregló v424');
}

// ═══════ PARTE 2B · v442 · la barra NO es global ═══════
// Es la razón por la que se retiró la barra de v440, y lo único que hay que no
// volver a romper al haberla traído de vuelta.
console.log('\n── PARTE 2B · sólo existe dentro de un partido ──');
{
    ok('2h · nace oculta', /<div id="match-events-bar" style="display:none;">/.test(SIN_COM));
    ok('2i · 🔑 la ENCIENDE renderMatch, que es la vista de detalle',
       /function renderMatch\(data\)[\s\S]{0,1200}?_mostrarBarraSucesos\(true\)/.test(SIN_COM));
    ok('2j · 🔑 y la APAGA la salida del detalle, por la que pasan las dos vías',
       /function _soltarPartidoVisible\(\)[\s\S]{0,600}?_mostrarBarraSucesos\(false\)/.test(SIN_COM),
       'showLiveNow y showHistory llaman ahí: el listado no puede tener barra');
    ok('2k · ⚠️ y la llamada de renderMatch va con guarda typeof',
       /if \(typeof _mostrarBarraSucesos === 'function'\) _mostrarBarraSucesos\(true\)/.test(SIN_COM),
       'renderMatch pinta campo, marcador y cronómetro: una excepción ahí no falla, MATA la vista');
    ok('2l · 🔑 la cabecera dice de QUÉ PARTIDO son los sucesos',
       /id="match-events-match"/.test(SIN_COM) &&
       /function _etiquetaBarraSucesos\(data\)[\s\S]{0,700}?homeTeam[\s\S]{0,300}?awayTeam/.test(SIN_COM),
       'era lo que le faltaba a la barra global con varios partidos en curso');
    ok('2n · el plegado manual se RECUERDA',
       /_SUCESOS_PLEGADA_KEY/.test(SIN_COM) &&
       /localStorage\.setItem\(_SUCESOS_PLEGADA_KEY/.test(SIN_COM));
    ok('2o · no queda la maquinaria de la barra GLOBAL retirada en v440',
       !/_matchEventsAutoCollapseTimer/.test(SIN_COM) && !/_setMatchEventsPanelMode/.test(SIN_COM),
       'el auto-despliegue vuelve, pero sobre una barra que ya no es global');
}

// ═══════ PARTE 2C · v443 · asoma sola 3 s, y el clic manda ═══════
// ⚠️ SUSTITUYE A LA ASERCIÓN 2m DE v442, que exigía justo lo contrario ("nada
// de temporizadores"). Es la OCTAVA vez que una aserción propia se pone del
// lado del defecto tras un cambio de criterio del autor — y esta vez la vieja
// no llegó a ponerse roja: seguía VERDE porque su regex no casaba con la nueva
// forma del setTimeout, o sea que estaba defendiendo nada. Por eso esta parte
// EJECUTA la máquina de estados en vez de mirarla de lejos.
//
// Lo que se fija es la petición literal del autor:
//   1 · un suceso la SUBE;  2 · baja sola a los 3 s;
//   3 · si la abre el usuario, NO baja hasta que él vuelva a pulsar.
console.log('\n── PARTE 2C · sube con el suceso, baja a los 3 s ──');
{
    const ini = MODULO.indexOf('const _SUCESOS_MS_AUTO');
    const fin = MODULO.indexOf('(function _initMatchEventsPanel()');
    ok('2p · el bloque de la ventana desplegable existe', ini !== -1 && fin > ini);

    if (ini !== -1 && fin > ini) {
        // DOM de mentira: sólo la barra y su botón. Y un reloj controlado, para
        // poder comprobar el "a los 3 segundos" sin esperar 3 segundos.
        const clases = new Set(['plegada']);
        const bar = { classList: {
            toggle(c, on) { if (on) clases.add(c); else clases.delete(c); },
            contains(c) { return clases.has(c); } } };
        const btn = { textContent: '', title: '', setAttribute() {} };
        let pendiente = null, sigId = 1;
        const sb = {
            console: { log() {}, warn() {} },
            document: { getElementById: (id) => id === 'match-events-bar' ? bar
                                       : id === 'match-events-toggle' ? btn : null },
            localStorage: { _d: {}, getItem(k) { return this._d[k] ?? null; },
                            setItem(k, v) { this._d[k] = v; } },
            _SUCESOS_PLEGADA_KEY: 'cronos_live_sucesos_plegada',
            setTimeout(fn, ms) { pendiente = { fn, ms, id: sigId++ }; return pendiente.id; },
            clearTimeout(id) { if (pendiente && pendiente.id === id) pendiente = null; },
        };
        vm.createContext(sb);
        vm.runInContext(MODULO.slice(ini, fin) +
            '\n;globalThis.suceso = _asomaSucesosPorEvento;' +
            '\n;globalThis.clic   = _alternaSucesosManual;' +
            '\n;globalThis.pon    = _aplicaPlegadoSucesos;' +
            '\n;globalThis.inicial= _plegadoInicialSucesos;' +
            '\n;globalThis.modo   = () => _sucesosModo;', sb);

        const abierta = () => !clases.has('plegada');
        const correElReloj = () => { const p = pendiente; pendiente = null; if (p) p.fn(); };

        sb.pon(sb.inicial());
        ok('2q · en reposo arranca PLEGADA', !abierta() && sb.modo() === 'plegada');

        // 1 · un suceso la sube
        sb.suceso();
        ok('2r · 🔑 un suceso la SUBE sola', abierta() && sb.modo() === 'auto');
        ok('2s · 🔑 y programa su bajada a los 3 SEGUNDOS exactos',
           pendiente && pendiente.ms === 3000, pendiente && pendiente.ms);

        // 2 · baja sola
        correElReloj();
        ok('2t · 🔑 pasado ese tiempo, baja sola', !abierta() && sb.modo() === 'plegada');

        // 3 · el clic manual manda
        sb.clic();
        ok('2u · un clic la abre en modo manual', abierta() && sb.modo() === 'manual');
        ok('2u2 · y ese clic CANCELA cualquier bajada pendiente', pendiente === null);
        sb.suceso();
        ok('2v · 🔑 un suceso NO le roba el control: sigue abierta y en manual',
           abierta() && sb.modo() === 'manual');
        ok('2v2 · 🔑 y NO se programa ninguna bajada mientras es manual',
           pendiente === null,
           'sin esto, el temporizador de un gol le cerraría la ventana en la cara al que está leyendo');
        sb.clic();
        ok('2w · 🔑 sólo otro clic la cierra', !abierta() && sb.modo() === 'plegada');

        // Un suceso mientras está asomada reinicia la cuenta atrás.
        sb.suceso();
        const primero = pendiente && pendiente.id;
        sb.suceso();
        ok('2x · cada suceso nuevo REINICIA la cuenta atrás',
           pendiente && pendiente.id !== primero,
           'si no, dos goles seguidos dejarían la ventana menos tiempo del debido');

        // 🔑 DESDE 'auto', EL CLIC LA FIJA — no la cierra. Sin esto el requisito
        // 3 del autor es inalcanzable: la ventana pasa la mayor parte del
        // tiempo asomada por un suceso, así que si el clic la cerrara habría
        // que esperar a que bajara sola para poder dejarla abierta.
        ok('2y · el estado de partida de esta comprobación es "auto"', sb.modo() === 'auto');
        sb.clic();
        ok('2y2 · 🔑 clic con la ventana ASOMADA = quedársela, no cerrarla',
           abierta() && sb.modo() === 'manual' && pendiente === null);

        // La elección manual se recuerda entre sesiones.
        ok('2z · al dejarla abierta se recuerda la elección',
           sb.localStorage._d['cronos_live_sucesos_plegada'] === '0' && sb.inicial() === 'manual');
        sb.clic();
        ok('2z2 · y al cerrarla, también', !abierta() && sb.inicial() === 'plegada');
    }
}

// ═══════ PARTE 3 · [DEFECTO B y C] ejecutado de verdad, SIN panel ═══════
console.log('\n── PARTE 3 · el motor, ejecutado sobre un DOM sin panel ──');
{
    // DOM de mentira: existe la lista, NO existe ningún panel. Es exactamente
    // la situación de producción tras la retirada.
    const filas = [];
    const lista = {
        appendChild(r) { filas.push(r); },
        set innerHTML(v) { if (v === '') filas.length = 0; },
        get innerHTML() { return ''; },
        scrollTop: 0, scrollHeight: 0, style: {},
    };
    const contador = { textContent: '' };
    const flash = { style: {}, classList: { _f: [], add(c) { this._f.push(c); }, remove() {} }, offsetWidth: 0 };
    // La barra, con sus clases de verdad: es lo que permite comprobar que el
    // suceso la hace ASOMAR de extremo a extremo, y no sólo que la máquina de
    // estados funcione por su cuenta.
    // La pila de avisos flotantes, para comprobar que el aviso se CREA.
    const pilaAvisos = [];
    const pila = {
        appendChild(el) { pilaAvisos.push(el); },
        get children() { return { length: pilaAvisos.length }; },
        get firstChild() { return pilaAvisos[0] || null; },
        removeChild() {},
    };
    const clasesBarra = new Set(['plegada']);
    const barra = { style: {}, classList: {
        toggle(c, on) { if (on) clasesBarra.add(c); else clasesBarra.delete(c); },
        contains(c) { return clasesBarra.has(c); }, add(c) { clasesBarra.add(c); }, remove(c) { clasesBarra.delete(c); } } };
    const generico = () => ({
        style: {}, classList: { toggle() {}, add() {}, remove() {} },
        appendChild() {}, remove() {}, set innerHTML(v) {}, get innerHTML() { return ''; },
        set textContent(v) {}, get textContent() { return ''; },
        get firstChild() { return null; }, children: { length: 0 }, offsetWidth: 0,
        offsetParent: null, getBoundingClientRect: () => ({ bottom: 0, height: 0 }),
        addEventListener() {}, removeEventListener() {}, querySelector() { return null; },
    });
    const vibrados = [];
    const osciladores = [];
    const sb = {
        console: { log() {}, warn() {}, error() {} },
        localStorage: { _d: {}, getItem(k) { return this._d[k] ?? null; }, setItem(k, v) { this._d[k] = v; } },
        document: {
            documentElement: { style: { setProperty() {} } },
            readyState: 'complete',
            getElementById(id) {
                if (id === 'match-events-list')  return lista;
                if (id === 'match-events-count') return contador;
                if (id === 'event-flash')        return flash;
                if (id === 'match-events-bar')   return barra;
                if (id === 'event-toast-stack')  return pila;
                // 🔑 CUALQUIER otro id no existe. En particular NO existe
                // 'match-events-panel': es el punto de la prueba.
                return generico();
            },
            createElement() { return { style: { cssText: '' }, set innerHTML(v) { this._h = v; }, get innerHTML() { return this._h || ''; } }; },
            addEventListener() {}, get body() { return generico(); },
        },
        navigator: { vibrate(p) { vibrados.push(p); } },
        location: { search: '', pathname: '/live.html', origin: 'http://x' },
        history: { pushState() {} },
        setTimeout() { return 0; }, clearTimeout() {}, setInterval() { return 0; }, clearInterval() {},
        URLSearchParams: function () { return { get() { return null; } }; },
        escapeHtml(s) { return String(s == null ? '' : s); },
        AudioContext: function () {
            return {
                state: 'running', currentTime: 0, resume() {},
                createOscillator() { const o = { frequency: { setValueAtTime() {} }, connect() {}, start() {}, stop() {} }; osciladores.push(o); return o; },
                createGain() { return { gain: { setValueAtTime() {}, exponentialRampToValueAtTime() {}, linearRampToValueAtTime() {} }, connect() {} }; },
                destination: {},
            };
        },
        initializeApp() { return {}; }, getAuth() { return {}; }, getFirestore() { return {}; },
        signInWithEmailAndPassword() {}, signOut() {}, onAuthStateChanged() {},
        browserLocalPersistence: {}, setPersistence() { return { catch() {} }; },
        doc() { return {}; }, getDoc() {}, collection() { return {}; },
        onSnapshot() { return () => {}; }, getDocs() { return Promise.resolve({ forEach() {} }); },
    };
    sb.window = sb; sb.globalThis = sb;
    sb.addEventListener = function () {}; sb.removeEventListener = function () {};
    sb.webkitAudioContext = sb.AudioContext;
    vm.createContext(sb);

    let arrancó = null;
    try {
        vm.runInContext(MODULO
            .replace(/^\s*import\s[^;]*;?$/gm, '')
            .replace(/import\s*{[^}]*}\s*from\s*['"][^'"]*['"];/g, '') +
            '\n;globalThis.__x = { showEventToast, _appendEventToHistoryPanel };',
            sb, { filename: 'live-mod.js' });
    } catch (e) { arrancó = e.message; }
    ok('3a · el módulo arranca aunque el panel retirado no exista', arrancó === null, arrancó);

    const X = sb.__x || {};
    const anunciar = X.showEventToast;
    const cargar = sb.window._loadMatchEventsFromSnapshot;

    if (typeof anunciar === 'function') {
        anunciar('goal', 'GOL · Pedro', 'CRONOS A vs CRONOS B', '1T 10:00');
        ok('3b · [DEFECTO B] 🔑 el suceso SE PINTA, con el panel inexistente',
           filas.length === 1,
           filas.length + ' filas; un `return` por panel ausente dejaría el cajón vacío para siempre');
        ok('3c · con su minuto de partido y su icono',
           /1T 10:00/.test(filas[0] ? filas[0].innerHTML : '') &&
           /GOL · Pedro/.test(filas[0] ? filas[0].innerHTML : ''),
           filas[0] && filas[0].innerHTML);
        ok('3d · el contador se actualiza', contador.textContent === '(1)', contador.textContent);
        ok('3e · 🔑 y la fila YA NO repite la etiqueta del partido',
           !/CRONOS A vs CRONOS B/.test(filas[0] ? filas[0].innerHTML : ''),
           'el cajón ES del partido: repetirlo en cada línea era ruido');

        // [DEFECTO D] retirar el aviso no es quedarse sin avisar.
        ok('3f · [DEFECTO D] 🔑 sigue sonando', osciladores.length > 0);
        ok('3g · [DEFECTO D] 🔑 sigue destellando', flash.classList._f.indexOf('fire') !== -1);
        ok('3h · [DEFECTO D] 🔑 y sigue vibrando', vibrados.length > 0);

        // 🔑 v444 · EL AVISO FLOTANTE, DE EXTREMO A EXTREMO. El autor lo
        // reportó como "roto por completo": sonaba pero no se veía nada. Aquí
        // se comprueba que el MISMO camino que pinta la fila crea también el
        // aviso, con su texto y con la etiqueta del partido.
        ok('3e2 · 🔑 el suceso crea el AVISO FLOTANTE',
           pilaAvisos.length === 1, pilaAvisos.length + ' avisos');
        ok('3e3 · con el texto del suceso y la etiqueta del partido',
           /GOL · Pedro/.test(pilaAvisos[0] ? pilaAvisos[0].innerHTML : '') &&
           /CRONOS A vs CRONOS B/.test(pilaAvisos[0] ? pilaAvisos[0].innerHTML : ''),
           pilaAvisos[0] && pilaAvisos[0].innerHTML);

        // 🔑 DE EXTREMO A EXTREMO: que la máquina de estados funcione no sirve
        // de nada si nadie la llama. Esto ejercita el camino real —el mismo por
        // el que detectAndAlert anuncia un gol— y comprueba que la ventana
        // ASOMA. Sin esta comprobación, borrar la llamada de
        // _appendEventToHistoryPanel pasaba desapercibido (mutación M10 del
        // red-check, verde con el defecto puesto).
        ok('3f2 · 🔑 el suceso hace ASOMAR la ventana (camino completo)',
           !clasesBarra.has('plegada'),
           'la máquina de estados puede estar perfecta y no estar conectada');

        // [DEFECTO C] el dedup de v424.
        anunciar('goal', 'GOL · Pedro', 'CRONOS A vs CRONOS B', '1T 10:00');
        ok('3i · [DEFECTO C] 🔑 el MISMO suceso no se pinta dos veces',
           filas.length === 1, filas.length + ' filas');
        anunciar('goal', 'GOL · Ana', 'CRONOS A vs CRONOS B', '1T 22:00');
        ok('3j · pero uno distinto sí', filas.length === 2, filas.length + ' filas');
    } else {
        ok('3b · showEventToast sigue existiendo', false, 'no se pudo extraer del módulo');
    }

    if (typeof cargar === 'function') {
        // La OTRA vía: reconstrucción completa desde el snapshot de Firestore.
        const DOS = [
            { type: 'goal',   text: 'GOL · Pedro',             icon: '⚽', realTime: '20:10:00', matchTime: '1T 10:00' },
            { type: 'yellow', text: 'TARJETA AMARILLA · Luis', icon: '🟨', realTime: '20:20:00', matchTime: '1T 20:00' },
            { type: 'tactical_move', text: '{"x":1}',          icon: '•',  realTime: '20:21:00', matchTime: '1T 21:00' },
        ];
        cargar(DOS);
        ok('3k · la reconstrucción desde el snapshot también pinta sin panel',
           filas.length === 2, filas.length + ' filas');
        ok('3l · y sigue cribando la telemetría táctica',
           !filas.some(f => /"x":1/.test(f.innerHTML)));

        // 🔑 v444 · LA VENTANA ASOMA POR LAS **DOS** VÍAS. Hasta v443 sólo la
        // hacía asomar _appendEventToHistoryPanel: un suceso que llegara por
        // esta reconstrucción se añadía en SILENCIO, con la ventana plegada.
        // Es el "el cajón no recibe los eventos" que reportó el autor.
        clasesBarra.add('plegada');                 // se parte de plegada
        cargar(DOS.concat([{ type: 'red', text: 'TARJETA ROJA · Ana', icon: '🟥',
                             realTime: '20:30:00', matchTime: '1T 30:00' }]));
        ok('3m · 🔑 un suceso NUEVO por la reconstrucción también la hace asomar',
           !clasesBarra.has('plegada'),
           'con una sola vía disparando, la mitad de los sucesos entraban sin avisar');

        // …pero NO al entrar en el partido, que es cuando se pinta el historial
        // entero de golpe.
        sb.window._matchEventsLog = [];
        filas.length = 0;
        clasesBarra.add('plegada');
        cargar(DOS);
        ok('3n · ⚠️ y NO asoma al entrar en el partido (historial entero de golpe)',
           clasesBarra.has('plegada'),
           'saltaría sola al abrir cualquier partido con sucesos previos');
    } else {
        ok('3k · _loadMatchEventsFromSnapshot sigue publicada', false);
    }
}

// ═══════ PARTE 5 · el cajón es de ESTE partido, no del anterior ═══════
// 🐛 Con la barra global este defecto no se veía; ahora el cajón dice ser del
// partido que se está viendo. La reconstrucción desde el snapshot sólo entra si
// el partido nuevo trae MÁS sucesos que los que ya hay pintados, así que saltar
// a un partido con 0 —o con menos— dejaba los del anterior en pantalla.
console.log('\n── PARTE 5 · cambiar de partido vacía el cajón ──');
{
    ok('5a · existe la función que lo vacía',
       /function _vaciarCajonSucesos\(\)/.test(SIN_COM));
    ok('5b · 🔑 y loadMatch la llama, con el resto del estado por partido',
       /window\.loadMatch = function\(matchId\)[\s\S]{0,2600}?_vaciarCajonSucesos\(\)/.test(SIN_COM),
       'sin esto, el partido nuevo se abre con los sucesos del anterior');
    ok('5c · vacía la lista, el contador Y el registro del dedup',
       /function _vaciarCajonSucesos\(\)[\s\S]{0,700}?_histVistos = new Set\(\)[\s\S]{0,400}?textContent = '\(0\)'/.test(SIN_COM),
       'si el dedup no se vacía, un suceso igual en el partido nuevo no se pintaría');
    // La condición que lo hacía necesario sigue ahí: se fija para que quien la
    // cambie sepa que este vaciado depende de ella.
    ok('5d · la reconstrucción sigue condicionada al número de sucesos',
       /localCount === 0 \|\| snapshotCount > localCount/.test(SIN_COM));
}

// ═══════ PARTE 4 · en el listado, cada tarjeta con lo suyo ═══════
console.log('\n── PARTE 4 · el listado conserva su mini-feed por tarjeta ──');
{
    ok('4a · cada tarjeta del listado sigue pintando sus últimos sucesos',
       /\$\{_liveFeedHtml\(m\)\}/.test(SIN_COM),
       'es el "cajón propio" de cada partido en el panel general');
    ok('4b · y con el equipo de cada suceso (v439)',
       /_liveFeedLado\(m, ev\)/.test(SIN_COM));
}

// ═══════ PARTE 5 · 🐛 EL HTML NO PUEDE QUEDARSE CACHEADO ═══════
// La razón REAL de que el autor siguiera viendo la versión anterior del visor
// tras dos despliegues. MEDIDO en producción: live.html se servía con
// `Cache-Control: max-age=3600` mientras index.html iba con `no-cache`, porque
// firebase.json sólo daba cabecera propia a /index.html, /sw.js, /auth.js y
// /app.js, y el resto cae en el `**` sin Cache-Control (Firebase pone una hora).
//
// 🔑 Y ES PEOR DE LO QUE PARECE: todo el versionado de este proyecto vive en
// los `?v=` que cache-bust.js escribe DENTRO del HTML. Si el HTML se cachea, el
// navegador no llega ni a enterarse de que hay marcadores nuevos: se queda con
// el HTML viejo Y con los ficheros viejos que ese HTML pide.
//
// ⚠️ Y ME ENGAÑÓ A MÍ TAMBIÉN: mis verificaciones de producción piden los
// ficheros con `?cb=<ahora>` y `cache: 'no-store'`, que esquivan exactamente
// esta caché. Daban verde mientras el navegador del autor servía la copia
// vieja. Un "verificado en producción" que no comprueba las CABECERAS no ve
// esta clase de fallo.
console.log('\n── PARTE 5 · el HTML no se cachea (firebase.json) ──');
{
    const fb = JSON.parse(fs.readFileSync(path.join(ROOT, 'firebase.json'), 'utf8'));
    const headers = (fb.hosting && fb.hosting.headers) || [];
    const noCache = (h) => (h.headers || []).some(x =>
        /cache-control/i.test(x.key) && /no-store/.test(x.value));

    const reglaHtml = headers.find(h => h.source === '**/*.html' && noCache(h));
    ok('5a · 🔑 hay una regla que declara TODOS los .html sin caché',
       !!reglaHtml,
       'declarada por FORMA y no fichero a fichero: así es como se coló live.html');

    // El caso concreto: la ruta del visor tiene que quedar cubierta.
    const cubre = (ruta) => headers.some(h => noCache(h) &&
        (h.source === ruta || h.source === '**/*.html'));
    ok('5b · live.html queda cubierto', cubre('/live.html'));
    ok('5c · index.html sigue cubierto', cubre('/index.html'));
    ok('5d · y sw.js también (es quien decide cuándo se actualiza todo)',
       headers.some(h => h.source === '/sw.js' && noCache(h)));

    // Alambre trampa: si alguien añade un HTML nuevo que se publique, la regla
    // por forma ya lo cubre. Lo que NO puede pasar es que la regla desaparezca
    // dejando sólo las de fichero suelto.
    const sueltas = headers.filter(h => /\.html$/.test(h.source || '') && h.source !== '**/*.html');
    ok('5e · las reglas por fichero suelto son un extra, no la única defensa',
       !!reglaHtml || sueltas.length === 0,
       sueltas.map(h => h.source).join(' '));
}

console.log('\n' + pass + ' PASS / ' + fail + ' FAIL');
process.exit(fail === 0 ? 0 : 1);

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
    ok('1c · ni la pila de avisos emergentes (#event-toast-stack)',
       !/event-toast/.test(SIN_COM),
       (SIN_COM.match(/[^\n]*event-toast-stack[^\n]*/) || ['(limpio)'])[0]);
    ok('1d · ni el z-index de guerra que la ponía por encima de todo',
       !/z-index:\s*9998/.test(SIN_COM));

    // Lo que SÍ puede seguir fijo, para que 1a no se lea como "nada fijo":
    // superposiciones a pantalla completa y el aviso de nueva versión, que va
    // ARRIBA. Se declaran para que la diferencia sea deliberada.
    ok('1e · lo que sigue fijo es a pantalla completa o va arriba (declarado)',
       /#event-flash\s*\{[^}]*position:\s*fixed[^}]*inset:\s*0/.test(SIN_COM) &&
       /id="update-banner"[\s\S]{0,200}position:\s*fixed;\s*top:\s*0/.test(SIN_COM));
}

// ═══════ PARTE 2 · el cajón está DENTRO del partido ═══════
console.log('\n── PARTE 2 · el cajón, dentro del banquillo ──');
{
    const aside = (SIN_COM.match(/<aside id="bench-panel">([\s\S]*?)<\/aside>/) || [, ''])[1];
    ok('2a · el banquillo sigue teniendo sus dos secciones de suplentes',
       /id="bench-home"/.test(aside) && /id="bench-away"/.test(aside));
    ok('2b · 🔑 y el cajón de sucesos va DENTRO, no suelto por la página',
       /id="match-events-box"/.test(aside) && /id="match-events-list"/.test(aside),
       'fuera del <aside> volvería a ser un elemento global');
    ok('2c · con su contador y su botón de limpiar',
       /id="match-events-count"/.test(aside) && /id="match-events-clear"/.test(aside));
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
    ok('2d · 🔑 la lista lleva alto ACOTADO y scroll propio',
       /#match-events-list\s*\{[^}]*max-height:/.test(cssBase) &&
       /#match-events-list\s*\{[^}]*overflow-y:\s*auto/.test(cssBase),
       'sin tope, una racha de sucesos empuja los suplentes fuera de la vista');
    ok('2d2 · y la medida se hace sobre la regla BASE, no sobre la de un @media',
       !/@media/.test(cssBase) && cssBase.length < SIN_COM.length,
       'con el CSS entero, la regla de móvil apaisado tapaba el defecto');
    ok('2e · y un estado vacío, para que no parezca roto antes del primer suceso',
       /#match-events-list:empty::after/.test(SIN_COM));
    // Donde el banquillo es una franja horizontal no cabe: se oculta.
    ok('2f · se oculta en las DOS maquetaciones de franja horizontal',
       (SIN_COM.match(/#match-events-box\s*\{\s*display:\s*none/g) || []).length === 2,
       'móvil vertical (96px) y tablet vertical (118px)');
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
        cargar([
            { type: 'goal',   text: 'GOL · Pedro',             icon: '⚽', realTime: '20:10:00', matchTime: '1T 10:00' },
            { type: 'yellow', text: 'TARJETA AMARILLA · Luis', icon: '🟨', realTime: '20:20:00', matchTime: '1T 20:00' },
            { type: 'tactical_move', text: '{"x":1}',          icon: '•',  realTime: '20:21:00', matchTime: '1T 21:00' },
        ]);
        ok('3k · la reconstrucción desde el snapshot también pinta sin panel',
           filas.length === 2, filas.length + ' filas');
        ok('3l · y sigue cribando la telemetría táctica',
           !filas.some(f => /"x":1/.test(f.innerHTML)));
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

console.log('\n' + pass + ' PASS / ' + fail + ' FAIL');
process.exit(fail === 0 ? 0 : 1);

// ─────────────────────────────────────────────────────────────────────────
// test_avisos_y_destinatarios.js · el aviso dice de qué partido es, y la lista
// de destinatarios no repite familiares (v449)
//
// Dos reportes del autor, independientes entre sí:
//   1. los avisos flotantes de `live.html` no dejan claro a qué partido
//      pertenece el gol o la tarjeta;
//   2. la lista de destinatarios al terminar el partido repite líneas del
//      mismo familiar.
//
// LO QUE PROTEGE:
//
//  A · EL ENCUENTRO ENCABEZA EL AVISO. ⚠️ El dato NO faltaba: viajaba desde
//      v220 y se pintaba en `.et-sub` — gris `--muted`, 0.72rem y en SEGUNDA
//      línea, debajo de un título que desde v445 empieza por el chip del
//      equipo de la incidencia. Se leía "ARINAGA 7 · GOL · Pedro" y el
//      encuentro pasaba desapercibido. Por eso este guard no comprueba que el
//      texto exista —ya existía— sino que ENCABECE el aviso y no vaya en el
//      color apagado.
//
//  B · NINGÚN AVISO ANÓNIMO. Si un llamante olvida la etiqueta, se
//      reconstruye del último snapshot. Y si no hay de dónde, NO SE INVENTA
//      (lección de v439): mejor sin línea que un "Local vs Visitante" falso.
//
//  C · 🔑 UNA LÍNEA POR FAMILIAR Y CÓDIGO DE JUGADOR. La lista se compone de
//      CUATRO orígenes que no se conocen entre sí, y las comprobaciones de
//      "¿ya existe?" de cada uno fallaban por dos motivos silenciosos:
//        · el familiar sin `parentUid` recibe como id el ID DEL DOCUMENTO DEL
//          VÍNCULO, así que dos vínculos del mismo padre dan dos ids distintos;
//        · cada origen compara por un campo distinto (uid / email / phone), de
//          modo que si una copia trae sólo el correo y otra sólo el teléfono,
//          NINGUNA comparación las une.
//
//  D · ⚠️ Y LO QUE NO SE PUEDE "ARREGLAR" DE MÁS: un padre con DOS hijos
//      convocados tiene que seguir viendo DOS líneas (son dos informes), y
//      quien es staff Y padre también, porque recibe el resumen global y el
//      individual. Deduplicar por persona a secas se llevaría por delante las
//      dos cosas, en silencio.
//
//  E · LA PRESELECCIÓN GUARDADA NO PUEDE PERDERSE. Al fusionar desaparecen
//      ids; si la casilla se comprobara sólo contra el id superviviente,
//      fusionar habría DESELECCIONADO a destinatarios ya elegidos.
// ─────────────────────────────────────────────────────────────────────────
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.join(__dirname, '..');
let fail = 0, pass = 0;
const ok = (name, cond, extra) => {
    if (cond) { pass++; console.log('PASS ' + name); }
    else { fail++; console.log('FAIL ' + name); if (extra !== undefined) console.log('       ' + String(extra).slice(0, 300)); }
};

const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');
const sinCom = (t) => t.replace(/\/\*[\s\S]*?\*\//g, '')
    .split(/\r?\n/).map(l => l.replace(/^\s*\/\/.*$/, '')).join('\n');

const LIVE_SRC  = read('live.html');
const UTILS_SRC = read('js/core/utils.js');
const WA_SRC    = read('js/shared/whatsapp-email.js');
const RPT_SRC   = read('js/coach/comms/match-reports-send.js');

function extractFn(src, name) {
    const start = src.indexOf('function ' + name + '(');
    if (start < 0) throw new Error('No encontrada: ' + name);
    let i = src.indexOf('{', start), depth = 0;
    for (; i < src.length; i++) {
        if (src[i] === '{') depth++;
        else if (src[i] === '}') { depth--; if (depth === 0) { i++; break; } }
    }
    return src.slice(start, i);
}

console.log('── el aviso dice su partido · la lista no repite familiares (v449) ──\n');

// ═══════════ PARTE 1 · EL AVISO, EJECUTADO ═══════════
console.log('── PARTE 1 · [A y B] el aviso flotante ──');

function pintarAviso(args, snapshot) {
    const nodos = [];
    const nuevo = (tag) => {
        const n = { tag, innerHTML: '', className: '', children: [], style: {},
                    appendChild(c) { this.children.push(c); }, remove() {},
                    get firstChild() { return this.children[0]; } };
        n.classList = { add: () => {}, remove: () => {} };
        nodos.push(n); return n;
    };
    const stack = nuevo('div');
    const sb = {
        console: { log() {}, warn() {} }, Date, Math, JSON, String, Object, Array, RegExp,
        setTimeout: () => 0,
        document: { createElement: nuevo,
                    getElementById: (id) => (id === 'event-toast-stack' ? stack : null) },
        EVENT_META: { goal:   { icon: '⚽', cls: 'ev-goal',   title: 'GOL',     flash: '#3fb950' },
                      yellow: { icon: '🟨', cls: 'ev-yellow', title: 'TARJETA', flash: '#e3b341' },
                      sub:    { icon: '🔄', cls: 'ev-sub',    title: 'CAMBIO',  flash: '#58a6ff' } },
        lastSnapshot: snapshot || null,
        escapeHtml: (s) => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({
            '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])),
        _equipoDeSuceso: () => '',
        _chipEquipoHtml: (eq) => (eq ? '<span class="chip-eq">' + eq + '</span>' : ''),
        _sinPrefijoEquipo: (t) => t,
        _posicionaAvisos: () => {},
        _appendEventToHistoryPanel: () => {},
        _alertsMuted: true, vibrate: () => {}, playEventSound: () => {},
    };
    sb.window = sb;
    vm.createContext(sb);
    vm.runInContext(extractFn(LIVE_SRC, '_etiquetaPartidoDe') + '\n' +
                    extractFn(LIVE_SRC, 'showEventToast'), sb);
    vm.runInContext('showEventToast(' + args + ')', sb);
    return stack.children.length ? stack.children[0].innerHTML : '';
}

{
    const html = pintarAviso('"goal", "<b>GOL</b> · Pedro", "ARINAGA 7 vs VISITANTE", "1T 23:15", ""');

    ok('1a · [A] el aviso lleva el nombre del encuentro',
       /class="et-match"[^>]*>ARINAGA 7 vs VISITANTE</.test(html), html);
    ok('1b · [A] 🔑 va DELANTE del suceso, encabezando el aviso',
       html.indexOf('et-match') !== -1 && html.indexOf('et-title') !== -1 &&
       html.indexOf('et-match') < html.indexOf('et-title'),
       'si va detrás vuelve a ser la segunda línea que nadie lee');
    ok('1c · [A] ya no se cuela en `.et-sub` (el sitio gris de antes)',
       !/et-sub/.test(html), html);

    // [B] respaldo: el llamante no pasa la etiqueta.
    const html2 = pintarAviso('"yellow", "<b>TARJETA</b> · Luis", null, "2T 05:00", ""',
                              { homeTeam: { name: 'DORAMAS B' }, awayTeam: { name: 'ARINAGA 11' } });
    ok('1d · [B] sin etiqueta, se reconstruye del último snapshot',
       /class="et-match"[^>]*>DORAMAS B vs ARINAGA 11</.test(html2), html2);

    // [B] y si no hay nada, NO se inventa. Se prueban los DOS caminos por los
    // que puede no haber nada: sin snapshot, y con snapshot pero sin nombres
    // de equipo (el segundo se le escapó al red-check la primera vez).
    const html3 = pintarAviso('"sub", "CAMBIO · Ana", null, "", ""', null);
    ok('1e · [B] 🔑 sin snapshot NO se inventa un "Local vs Visitante"',
       !/et-match/.test(html3), html3);
    const html3b = pintarAviso('"sub", "CAMBIO · Ana", null, "", ""', { homeTeam: {}, awayTeam: {} });
    ok('1e2 · [B] 🔑 con snapshot pero SIN nombres, tampoco se inventa',
       !/et-match/.test(html3b), html3b);

    // El nombre del equipo es dato de usuario: hay que escaparlo.
    const html4 = pintarAviso('"goal", "GOL", "<img src=x onerror=alert(1)> vs B", "", ""');
    ok('1f · el nombre del encuentro se ESCAPA',
       html4.indexOf('&lt;img') !== -1 && html4.indexOf('<img') === -1, html4);
}

// Censo estático: la vía principal no puede depender del respaldo.
{
    const L = sinCom(LIVE_SRC);
    const llamadas = L.match(/showEventToast\(/g) || [];
    ok('1g · siguen existiendo los llamantes de showEventToast',
       llamadas.length >= 8, llamadas.length + ' llamadas');

    const sinEtiqueta = (L.match(/showEventToast\([^)]*\)/g) || [])
        .filter(s => !/matchLabel|_linea,\s*matchLabel/.test(s))
        .filter(s => !/^showEventToast\(type,/.test(s));   // la propia definición
    ok('1h · todos los llamantes pasan `matchLabel`',
       sinEtiqueta.length === 0,
       'sin etiqueta: ' + sinEtiqueta.join(' | '));

    ok('1i · [A] la clase `.et-match` está definida y NO usa el gris apagado',
       /\.et-match\s*\{[^}]*font-weight:\s*800/.test(L) &&
       !/\.et-match\s*\{[^}]*var\(--muted\)/.test(L),
       'si vuelve a --muted, vuelve a no leerse');
    ok('1j · [A] tiene tamaño propio en las dos bandas móviles',
       (L.match(/\.event-toast \.et-match \{/g) || []).length >= 2);
}

// ═══════════ PARTE 2 · LA DEDUPLICACIÓN, EJECUTADA ═══════════
console.log('\n── PARTE 2 · [C, D y E] una línea por familiar y jugador ──');

function cargarUtils() {
    const sb = { console: { log() {}, warn() {} }, Date, Math, JSON, String, Object,
                 Array, RegExp, Map, Set, document: { getElementById: () => null },
                 localStorage: { getItem: () => null, setItem: () => {} },
                 navigator: { userAgent: 'node' } };
    sb.window = sb;
    vm.createContext(sb);
    vm.runInContext(UTILS_SRC, sb);
    return sb;
}

{
    const sb = cargarUtils();
    const dedupe = sb.window._cronosDedupeRecipients;
    ok('2a · el helper existe y es una función', typeof dedupe === 'function');

    // [C] El mismo padre, por dos vías: una trae sólo el correo, la otra sólo
    // el teléfono, y comparten uid. Ninguna comparación de las de antes las unía.
    let r = dedupe([
        { id: 'link_abc', type: 'parent', uid: 'u1', name: 'Ana Pérez', playerId: 'J-01', email: 'ana@x.com' },
        { id: 'u1',       type: 'parent', uid: 'u1', name: 'Ana Pérez', playerId: 'J-01', phone: '600112233' },
    ]);
    ok('2b · [C] 🔑 dos copias del mismo familiar → UNA línea',
       r.length === 1, JSON.stringify(r.map(x => x.id)));
    ok('2c · [C] la línea conserva el correo Y el teléfono',
       r[0].email === 'ana@x.com' && r[0].phone === '600112233', JSON.stringify(r[0]));
    ok('2d · [E] 🔑 conserva los DOS ids en `_ids`',
       Array.isArray(r[0]._ids) && r[0]._ids.indexOf('link_abc') !== -1 && r[0]._ids.indexOf('u1') !== -1,
       JSON.stringify(r[0]._ids));

    // [C] Sin uid: el id del vínculo no sirve como identidad, pero el correo sí.
    r = dedupe([
        { id: 'lnk_1', type: 'parent', name: 'Luis Gómez', playerId: 'J-07', email: 'luis@x.com' },
        { id: 'lnk_2', type: 'parent', name: 'Luis Gómez', playerId: 'J-07', email: 'LUIS@x.com', phone: '611223344' },
    ]);
    ok('2e · [C] dos vínculos distintos del mismo padre → UNA línea (correo, sin distinguir mayúsculas)',
       r.length === 1 && r[0].phone === '611223344', JSON.stringify(r));

    // [C] Teléfono escrito de tres formas.
    r = dedupe([
        { id: 'a', type: 'parent', name: 'Rosa', playerId: 'J-09', phone: '+34 600 11 22 33' },
        { id: 'b', type: 'parent', name: 'Rosa', playerId: 'J-09', phone: '0034600112233' },
        { id: 'c', type: 'parent', name: 'Rosa', playerId: 'J-09', phone: '600112233', email: 'rosa@x.com' },
    ]);
    ok('2f · [C] el mismo teléfono en tres formatos → UNA línea',
       r.length === 1 && r[0].email === 'rosa@x.com', JSON.stringify(r));

    // ── [D] LO QUE NO SE PUEDE FUSIONAR ──────────────────────────────
    r = dedupe([
        { id: 'p1', type: 'parent', uid: 'u9', name: 'Marta', playerId: 'J-02', email: 'marta@x.com' },
        { id: 'p2', type: 'parent', uid: 'u9', name: 'Marta', playerId: 'J-05', email: 'marta@x.com' },
    ]);
    ok('2g · [D] 🔑 un padre con DOS hijos convocados sigue viendo DOS líneas',
       r.length === 2, 'son dos informes distintos: ' + JSON.stringify(r.map(x => x.playerId)));

    r = dedupe([
        { id: 'p1', type: 'parent', name: 'Padre de Juan',  playerId: 'J-03', email: 'a@x.com' },
        { id: 'p2', type: 'parent', name: 'Madre de Juan',  playerId: 'J-03', email: 'b@x.com' },
    ]);
    ok('2h · [D] dos familiares DISTINTOS del mismo jugador → dos líneas',
       r.length === 2, JSON.stringify(r.map(x => x.name)));

    r = dedupe([
        { id: 's1', type: 'staff',  uid: 'u5', name: 'Carlos', email: 'carlos@x.com' },
        { id: 'p1', type: 'parent', uid: 'u5', name: 'Carlos', email: 'carlos@x.com', playerId: 'J-04' },
    ]);
    ok('2i · [D] 🔑 quien es staff Y padre conserva sus dos líneas',
       r.length === 2, 'recibe el resumen global Y el informe de su hijo');

    // Dos "Padre/Tutor" sin identificadores pero con correos propios: el
    // nombre por sí solo no puede fundirlos.
    r = dedupe([
        { id: 'x1', type: 'parent', name: 'Padre/Tutor', playerId: 'J-06', email: 'uno@x.com' },
        { id: 'x2', type: 'parent', name: 'Padre/Tutor', playerId: 'J-06', email: 'dos@x.com' },
    ]);
    ok('2j · [D] el nombre genérico NO funde a dos personas con correos distintos',
       r.length === 2, JSON.stringify(r.map(x => x.email)));

    // Sin ningún identificador, el nombre sí vale.
    r = dedupe([
        { id: 'y1', type: 'parent', name: 'Abuelo de Ana', playerId: 'J-08' },
        { id: 'y2', type: 'parent', name: 'abuelo de ana', playerId: 'J-08' },
    ]);
    ok('2k · sin identificadores, el mismo nombre sí funde',
       r.length === 1, JSON.stringify(r));

    // Orden y robustez.
    r = dedupe([
        { id: 'a', type: 'staff',  name: 'Zoe',  email: 'z@x.com' },
        { id: 'b', type: 'parent', name: 'Ana',  email: 'a@x.com', playerId: 'J-01' },
        { id: 'c', type: 'staff',  name: 'Zoe',  email: 'z@x.com' },
    ]);
    ok('2l · se respeta el orden de aparición',
       r.length === 2 && r[0].name === 'Zoe' && r[1].name === 'Ana', JSON.stringify(r.map(x => x.name)));
    ok('2m · entradas nulas y no-array no rompen',
       dedupe([null, undefined, { id: 'q', type: 'staff', name: 'Q' }]).length === 1 &&
       dedupe(null).length === 0 && dedupe('no soy un array').length === 0);

    // Las etiquetas se unen: si una copia trae 'rpt' y otra no, no se pierde.
    r = dedupe([
        { id: 'a', type: 'parent', uid: 'u2', name: 'Eva', playerId: 'J-10', tags: ['msg'] },
        { id: 'b', type: 'parent', uid: 'u2', name: 'Eva', playerId: 'J-10', tags: ['rpt'] },
    ]);
    ok('2n · las etiquetas de las copias se UNEN (no se pierde el `rpt`)',
       r.length === 1 && r[0].tags.indexOf('rpt') !== -1 && r[0].tags.indexOf('msg') !== -1,
       JSON.stringify(r[0].tags));
}

// ═══ PARTE 2B · LA REGLA EXACTA DEL AUTOR ═══
// "Varias líneas SÍ, si son PERSONAS DISTINTAS. Nunca dos líneas del MISMO
//  usuario/familiar."
//
// 🔑🔑 AQUÍ ESTUVO EL FALLO DE LA PRIMERA VERSIÓN, y no era teórico: agrupaba
// por UN código de hijo elegido con una cadena de respaldos
// (`playerId || '#'+dorsal || nombre`). Pero los cuatro orígenes escriben el
// hijo DISTINTO para el mismo niño —'J-01', 'J1', el dorsal 1, "Marcos", o
// nada—, así que la misma persona caía en grupos distintos y NUNCA se llegaban
// a comparar. Salía dos veces. Ahora la persona manda y el hijo sólo SEPARA
// cuando se demuestra que son distintos.
console.log('\n── PARTE 2B · una línea por persona real ──');
{
    const sb = cargarUtils();
    const dedupe = sb.window._cronosDedupeRecipients;
    const n = (arr) => dedupe(arr).length;

    // ── El mismo familiar, expresado como lo hace cada origen ──────────
    ok('2p · 🔑 mismo familiar, hijo como "J-01" y como dorsal 1 → UNA línea',
       n([{ id: 'a', type: 'parent', name: 'Ana', email: 'ana@x.com', playerId: 'J-01' },
          { id: 'b', type: 'parent', name: 'Ana', email: 'ana@x.com', playerNumber: 1 }]) === 1);

    ok('2q · 🔑 mismo familiar, "J-01" frente a "J1" (los dos formatos reales) → UNA',
       n([{ id: 'a', type: 'parent', name: 'Ana', email: 'ana@x.com', playerId: 'J-01' },
          { id: 'b', type: 'parent', name: 'Ana', email: 'ana@x.com', playerId: 'J1' }]) === 1);

    ok('2r · 🔑 mismo familiar, uno con código y otro sólo con el nombre del hijo → UNA',
       n([{ id: 'a', type: 'parent', name: 'Ana', email: 'ana@x.com', playerId: 'J-01', player: 'Marcos' },
          { id: 'b', type: 'parent', name: 'Ana', email: 'ana@x.com', player: 'Marcos' }]) === 1);

    ok('2s · 🔑 mismo familiar, una copia SIN dato de hijo (usuario registrado) → UNA',
       n([{ id: 'a', type: 'parent', name: 'Ana', email: 'ana@x.com', playerId: 'J-01' },
          { id: 'b', type: 'parent', uid: 'u_ana', name: 'Ana', email: 'ana@x.com' }]) === 1);

    ok('2t · el relleno "Jugador" no cuenta como hijo distinto',
       n([{ id: 'a', type: 'parent', name: 'Ana', email: 'ana@x.com', player: 'Marcos' },
          { id: 'b', type: 'parent', name: 'Ana', email: 'ana@x.com', player: 'Jugador' }]) === 1);

    ok('2u · el dorsal con ceros a la izquierda es el mismo dorsal',
       n([{ id: 'a', type: 'parent', name: 'Ana', email: 'ana@x.com', playerNumber: '01' },
          { id: 'b', type: 'parent', name: 'Ana', email: 'ana@x.com', playerNumber: 1 }]) === 1);

    // Cadena de tres saltos: los alias se acumulan o la cadena se rompe.
    ok('2v · 🔑 cadena de tres copias (código → dorsal → nombre) → UNA sola línea',
       n([{ id: 'a', type: 'parent', name: 'Ana', email: 'ana@x.com', playerId: 'J-01' },
          { id: 'b', type: 'parent', name: 'Ana', email: 'ana@x.com', playerNumber: 1, player: 'Marcos' },
          { id: 'c', type: 'parent', name: 'Ana', email: 'ana@x.com', player: 'Marcos' }]) === 1,
       'sin acumular los alias, el tercer salto abre línea nueva');

    // ⚠️ EL ORDEN IMPORTA, y esta es la prueba que lo demuestra: si la copia
    // SIN dato de hijo llega la primera, el cubo nace sin códigos. Los alias
    // tienen que ACUMULARSE al fusionar; si no, el cubo se queda "en blanco"
    // para siempre y el hijo siguiente —que sí es otro— tampoco lo contradice
    // y acaba fundido en la misma línea. Lo destapó el red-check.
    ok('2v2 · 🔑 copia sin hijo PRIMERO, luego dos hijos distintos → DOS líneas',
       n([{ id: 'a', type: 'parent', name: 'Marta', email: 'm@x.com' },
          { id: 'b', type: 'parent', name: 'Marta', email: 'm@x.com', playerId: 'J-02' },
          { id: 'c', type: 'parent', name: 'Marta', email: 'm@x.com', playerId: 'J-05' }]) === 2,
       'sin acumular los alias, los dos hermanos caen en la misma línea');

    // ── PERSONAS DISTINTAS: siguen siendo varias líneas ────────────────
    ok('2w · [D] padre Y madre del mismo hijo → DOS líneas',
       n([{ id: 'a', type: 'parent', name: 'Padre', email: 'p@x.com', playerId: 'J-03' },
          { id: 'b', type: 'parent', name: 'Madre', email: 'm@x.com', playerId: 'J-03' }]) === 2,
       'son personas distintas: cada una recibe lo suyo');

    ok('2x · [D] padres separados, dos correos y dos teléfonos → DOS líneas',
       n([{ id: 'a', type: 'parent', name: 'Ana', email: 'ana@x.com', phone: '600111111', playerId: 'J-03' },
          { id: 'b', type: 'parent', name: 'Luis', email: 'luis@x.com', phone: '600222222', playerId: 'J-03' }]) === 2);

    ok('2y · [D] el entrenador es otra persona → línea propia',
       n([{ id: 'a', type: 'parent', name: 'Ana', email: 'ana@x.com', playerId: 'J-03' },
          { id: 'b', type: 'staff',  name: 'Entrenador', email: 'coach@x.com' }]) === 2);

    ok('2z · [D] el mismo familiar con DOS hijos convocados → DOS líneas',
       n([{ id: 'a', type: 'parent', name: 'Marta', email: 'm@x.com', playerId: 'J-02' },
          { id: 'b', type: 'parent', name: 'Marta', email: 'm@x.com', playerId: 'J-05' }]) === 2,
       'confirmado por el autor: son dos informes distintos');

    ok('2z2 · [D] sin códigos, dos NOMBRES de hijo distintos también separan',
       n([{ id: 'a', type: 'parent', name: 'Marta', email: 'm@x.com', player: 'Marcos' },
          { id: 'b', type: 'parent', name: 'Marta', email: 'm@x.com', player: 'Sara' }]) === 2,
       'Marcos y Sara son dos hermanos, aunque nadie traiga el dorsal');

    // ⚠️ El nombre funde a dos copias con datos de contacto complementarios,
    // pero NO puede fundir a dos personas reales que se llamen igual porque
    // nadie les puso nombre propio.
    ok('2z3 · 🔑 un nombre de RELLENO no funde a dos personas',
       n([{ id: 'a', type: 'parent', name: 'Padre/Tutor', phone: '600111111', playerId: 'J-03' },
          { id: 'b', type: 'parent', name: 'Padre/Tutor', email: 'otro@x.com', playerId: 'J-03' }]) === 2,
       'podrían ser el padre y la madre del mismo hijo, cada uno con un dato');

    // ⚠️ Dos correos DISTINTOS son una contradicción, y ante ella el nombre no
    // manda: podrían ser dos personas que se llaman igual. Se prefiere una
    // línea de más a fundir a dos personas reales y mandarle a una el informe
    // del hijo de la otra.
    ok('2j2 · 🔑 mismo nombre pero correos que se CONTRADICEN → dos líneas',
       n([{ id: 'a', type: 'parent', name: 'Ana Pérez', email: 'ana1@x.com', playerId: 'J-03' },
          { id: 'b', type: 'parent', name: 'Ana Pérez', email: 'ana2@x.com', playerId: 'J-03' }]) === 2,
       'el nombre no puede pasar por encima de dos identificadores fuertes distintos');

    ok('2z4 · pero un nombre PROPIO sí une copias con datos complementarios',
       n([{ id: 'a', type: 'parent', name: 'Ana Pérez', phone: '600111111', playerId: 'J-03' },
          { id: 'b', type: 'parent', name: 'Ana Pérez', email: 'ana@x.com',  playerId: 'J-03' }]) === 1,
       'una copia manual con teléfono y otra de Firestore con correo');

    // El caso completo: 4 orígenes, 3 personas reales, uno con dos hijos.
    const revuelto = [
        { id: 'lnk1', type: 'parent', name: 'Ana Pérez', email: 'ana@x.com', playerId: 'J-01' },
        { id: 'u_a',  type: 'parent', name: 'Ana Pérez', uid: 'u_a', email: 'ana@x.com', playerNumber: 1 },
        { id: 'man1', type: 'parent', name: 'Ana Pérez', phone: '600112233', player: 'Marcos' },
        { id: 'lnk2', type: 'parent', name: 'Ana Pérez', email: 'ana@x.com', playerId: 'J-07' },
        { id: 'lnk3', type: 'parent', name: 'Luis Soto', email: 'luis@x.com', playerId: 'J-01' },
        { id: 's1',   type: 'staff',  name: 'Director',  email: 'dir@x.com' },
        { id: 's2',   type: 'staff',  name: 'Director',  uid: 'u_dir', email: 'dir@x.com' },
    ];
    const res = dedupe(revuelto);
    ok('2aa · 🔑 el caso completo: 7 entradas → 4 líneas',
       res.length === 4,
       'Ana(Marcos) + Ana(2º hijo) + Luis + Director. Salen ' + res.length + ': ' +
       JSON.stringify(res.map(x => x.name + '/' + (x.playerId || x.playerNumber || x.player || '—'))));
}

// ═══════════ PARTE 3 · LOS DOS CONSTRUCTORES, EJECUTADOS ═══════════
// ⚠️ Esta parte empezó siendo un censo de regex y el RED-CHECK la tumbó: al
// desenganchar el helper, la aserción seguía en VERDE porque el nombre
// `_cronosDedupeRecipients` continuaba apareciendo en la línea de al lado. Es
// exactamente la misma clase de aserción-que-defiende-el-bug de v417 y v447.
// Ahora se PINTA la lista de verdad y se cuentan las casillas.
console.log('\n── PARTE 3 · [C y E] la lista pintada de verdad ──');

// Extrae `window.NOMBRE = function(...) {...}` balanceando llaves.
function extractWinFn(src, name) {
    const start = src.indexOf('window.' + name + ' = function');
    if (start < 0) throw new Error('No encontrada: window.' + name);
    let i = src.indexOf('{', src.indexOf('(', start)), depth = 0;
    for (; i < src.length; i++) {
        if (src[i] === '{') depth++;
        else if (src[i] === '}') { depth--; if (depth === 0) { i++; break; } }
    }
    return src.slice(start, i);
}

function montarPintor(contactos, guardados) {
    const sb = cargarUtils();
    sb.emailConfig = { contacts: contactos };
    sb.escapeHtml = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({
        '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
    sb.escapeAttr = sb.escapeHtml;
    sb.localStorage = {
        getItem: () => (guardados ? JSON.stringify(guardados) : null),
        setItem: () => {},
    };
    vm.runInContext(extractWinFn(WA_SRC, 'sharedBuildRecipientsHTML'), sb);
    vm.runInContext(extractFn(RPT_SRC, 'buildConvocationRecipientsHTML') +
                    '\n;globalThis.buildConv = buildConvocationRecipientsHTML;', sb);
    return sb;
}

const contarCasillas = (html, prefijo) =>
    (html.match(new RegExp('class="' + prefijo + '-recipient-chk"', 'g')) || []).length;
const contarMarcadas = (html) => (html.match(/checked/g) || []).length;

{
    // El caso real que reportó el autor: el mismo familiar por dos vías (el
    // vínculo con su id de documento, y el usuario registrado con su uid).
    const duplicados = [
        { id: 'lnk_1', type: 'parent', name: 'Ana Pérez', player: 'Marcos', playerId: 'J-01',
          email: 'ana@x.com', tags: ['rpt'] },
        { id: 'u_ana', type: 'parent', name: 'Ana Pérez', player: 'Marcos', playerId: 'J-01',
          uid: 'u_ana', email: 'ana@x.com', phone: '600112233', tags: ['rpt'] },
        { id: 's_dir', type: 'staff',  name: 'Director', email: 'dir@x.com', tags: ['rpt'] },
    ];

    let sb = montarPintor(duplicados, null);
    let html = vm.runInContext("window.sharedBuildRecipientsHTML(null, 'rpt')", sb);
    ok('3a · [C] 🔑 FIN DE PARTIDO: el familiar repetido sale UNA sola vez',
       contarCasillas(html, 'rpt') === 2,
       'casillas pintadas: ' + contarCasillas(html, 'rpt') + ' (esperadas 2: Ana + Director)');
    ok('3b · [C] y la línea que queda muestra su correo Y su teléfono',
       html.indexOf('ana@x.com') !== -1 && html.indexOf('600112233') !== -1,
       'es la "opción de correo/envío" que el autor quiere ver limpia');

    // [D] El padre con DOS hijos convocados: dos líneas, no una.
    const dosHijos = [
        { id: 'a', type: 'parent', name: 'Marta', player: 'Juan', playerId: 'J-02', email: 'm@x.com', tags: ['rpt'] },
        { id: 'b', type: 'parent', name: 'Marta', player: 'Sara', playerId: 'J-05', email: 'm@x.com', tags: ['rpt'] },
    ];
    sb = montarPintor(dosHijos, null);
    html = vm.runInContext("window.sharedBuildRecipientsHTML(null, 'rpt')", sb);
    ok('3c · [D] 🔑 el padre con DOS hijos convocados conserva sus DOS líneas',
       contarCasillas(html, 'rpt') === 2,
       'casillas: ' + contarCasillas(html, 'rpt') + ' — son dos informes distintos');

    // [E] La preselección se guardó con el id de la copia ABSORBIDA — que es
    // el caso que importa. ⚠️ Ojo: hay que usar el id de la copia que
    // DESAPARECE ('u_ana'), no el de la que sobrevive ('lnk_1'); con el
    // superviviente la prueba pasa aunque el arreglo no esté, y así se me
    // coló la primera vez (lo cazó el red-check).
    sb = montarPintor(duplicados, ['u_ana']);
    html = vm.runInContext("window.sharedBuildRecipientsHTML(null, 'rpt')", sb);
    ok('3d · [E] 🔑 la preselección guardada con el id ABSORBIDO sigue marcando',
       contarMarcadas(html) === 1,
       'marcadas: ' + contarMarcadas(html) + ' — si es 0, fusionar ha deseleccionado a Ana');

    // Y lo mismo en el constructor de la convocatoria previa.
    sb = montarPintor(duplicados, null);
    html = vm.runInContext(
        "buildConv({ ids: ['J-01'], numbers: [] }, 'rpt', " + JSON.stringify(duplicados) + ")", sb);
    ok('3e · [C] 🔑 CONVOCATORIA: el familiar repetido también sale una vez',
       contarCasillas(html, 'rpt') === 2,
       'casillas: ' + contarCasillas(html, 'rpt') + ' (esperadas 2: Ana + Director)');

    sb = montarPintor(duplicados, ['u_ana']);
    html = vm.runInContext(
        "buildConv({ ids: ['J-01'], numbers: [] }, 'rpt', " + JSON.stringify(duplicados) + ")", sb);
    ok('3f · [E] 🔑 CONVOCATORIA: la preselección fusionada también aguanta',
       contarMarcadas(html) === 1, 'marcadas: ' + contarMarcadas(html));

    // [D] Y el caso que aísla el CÓDIGO del jugador: dos hijos cuyas entradas
    // no traen el nombre del jugador, sólo el código. Si el constructor deja
    // de llevar `playerId` a la lista, estos dos se fundirían en uno.
    const dosHijosSoloCodigo = [
        { id: 'a', type: 'parent', name: 'Marta', playerId: 'J-02', email: 'm@x.com', tags: ['rpt'] },
        { id: 'b', type: 'parent', name: 'Marta', playerId: 'J-05', email: 'm@x.com', tags: ['rpt'] },
    ];
    sb = montarPintor(dosHijosSoloCodigo, null);
    html = vm.runInContext("window.sharedBuildRecipientsHTML(null, 'rpt')", sb);
    ok('3g · [C] 🔑 el CÓDIGO del jugador llega a la lista y separa a los hermanos',
       contarCasillas(html, 'rpt') === 2,
       'casillas: ' + contarCasillas(html, 'rpt') + ' — sin el playerId se funden en una');
}

console.log('\n' + '─'.repeat(60));
console.log(`Resultado: ${pass} PASS · ${fail} FAIL`);
process.exit(fail === 0 ? 0 : 1);

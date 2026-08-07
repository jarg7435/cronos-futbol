// ─────────────────────────────────────────────────────────────────────────
// test_avisos_por_tarjeta.js  ·  una pila de avisos POR PARTIDO en el listado
// en vivo, alineada a su tarjeta, con rescate al borde (v466)
//
// Reporte del autor (implementar.txt): con varios partidos abiertos, los avisos
// flotantes "solo aparecen en el ultimo partido creado o en el ultimo que se
// abrio y cerro", y los demas partidos se quedan sin alertas.
//
// ⚠️ EL DIAGNOSTICO DEL REPORTE NO ERA EL MECANISMO, y se comprobo ANTES de
// tocar nada: la suscripcion estaba bien. El vigilante de fondo sigue suscrito
// a TODOS los partidos seguidos (solo se cancela al cerrar sesion) y
// showEventToast procesa los de fondo desde v455. Lo que habia era UNA SOLA
// pila, `#event-toast-stack`, fija en la esquina y colocada por
// `_posicionaAvisos()` MIDIENDO DESDE EL MARCADOR del partido abierto: los
// avisos de los tres partidos salian, pero caian todos en el mismo sitio y
// parecian del mismo partido. Si se hubiera "arreglado" la suscripcion se
// habria tocado algo que no estaba roto.
//
// LO QUE PROTEGE, y por que cada cosa se rompe sola:
//
//  A · 🔑🔑 LAS PILAS NO VIVEN DENTRO DE LAS TARJETAS. `showLiveNow` repinta la
//      lista entera con `listEl.innerHTML = ''` en CADA latido de CUALQUIER
//      partido —cada pocos segundos—, asi que un aviso metido en la tarjeta se
//      destruiria antes de poder leerse. Es la trampa numero uno de este
//      diseño y la que parece mas natural al escribirlo.
//
//  B · CADA PARTIDO, SU PILA. Dos partidos no pueden compartir pila ni
//      robarsela: es el defecto que se viene a arreglar.
//
//  C · ALINEADA A SU TARJETA. La pila se coloca midiendo la tarjeta por su
//      `data-match-id`; si la tarjeta se mueve (scroll, repintado), la pila la
//      sigue.
//
//  D · 🔑 RESCATE AL BORDE (decision del autor). Si la tarjeta esta fuera de la
//      pantalla, un aviso pegado a ella seria INVISIBLE — justo lo que se viene
//      a arreglar. Esos avisos bajan al borde con el nombre del partido. Sus
//      dos requisitos chocan aqui y esta es la resolucion: "alineado a su
//      tarjeta" cede ante "ningun suceso queda oculto".
//
//  E · EL UMBRAL DE VISIBILIDAD NO ES CERO. Con una tarjeta medio salida, un
//      aviso anclado sale cortado por el borde y da la misma sensacion de "no
//      se ve" que se arregla.
//
//  F · FUERA DEL LISTADO NO QUEDAN PILAS. Dentro de un partido manda la pila de
//      siempre (v444/v457, ya verificada por el autor); las del listado tienen
//      que retirarse o competirian por el mismo sitio.
//
// ESTE GUARD EJECUTA LA LOGICA contra un DOM simulado con scroll de verdad.
// Un regex veria que las funciones existen, no DONDE acaba cada aviso.
// ─────────────────────────────────────────────────────────────────────────
const fs   = require('fs');
const path = require('path');
const vm   = require('vm');

const ROOT = path.join(__dirname, '..');
let fail = 0, pass = 0;
const ok = (name, cond, extra) => {
    if (cond) { pass++; console.log('PASS ' + name); }
    else { fail++; console.log('FAIL ' + name); if (extra !== undefined) console.log('       ' + extra); }
};

const LIVE = fs.readFileSync(path.join(ROOT, 'live.html'), 'utf8');

console.log('── avisos por tarjeta en el listado en vivo (v466) ──\n');

// ═══ 0 · ¿compila live.html? Un guard de regex no ve un fichero roto ═══
(function compila() {
    const os = require('os'), cp = require('child_process');
    const bloques = LIVE.match(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi) || [];
    let malos = 0, msg = [];
    bloques.forEach((b, i) => {
        const m = b.match(/<script\b([^>]*)>([\s\S]*)<\/script>/i);
        const attrs = m[1] || '', js = m[2] || '';
        if (/\bsrc\s*=/.test(attrs) || !js.trim()) return;
        const tmp = path.join(os.tmpdir(), 'cav_' + i + '_' + Date.now() +
            (/type\s*=\s*["']module["']/.test(attrs) ? '.mjs' : '.cjs'));
        fs.writeFileSync(tmp, js, 'utf8');
        try { cp.execFileSync(process.execPath, ['--check', tmp], { stdio: 'pipe' }); }
        catch (e) { malos++; msg.push(String(e.stderr || e.message).split('\n').slice(0, 3).join(' / ')); }
        finally { try { fs.unlinkSync(tmp); } catch (e) {} }
    });
    ok('0 · ⚠️ live.html PARSEA (un acento grave en un template lo tumba entero)',
       malos === 0, msg.join(' | '));
    if (malos) process.exit(1);
})();

// ══════════════ DOM simulado ══════════════
// Lo justo para ejecutar la colocacion: rectangulos, clases, estilos y los dos
// selectores que usa el codigo. El scroll se simula moviendo los rectangulos,
// que es lo que de verdad le pasa a una tarjeta.
const ALTO = 800, ANCHO = 400;

function Elem(tag) {
    const clases = new Set();
    const attrs = {};
    const el = {
        tagName: tag, children: [], parent: null,
        style: {}, id: '', offsetParent: {},
        _rect: null,
        classList: {
            add: c => clases.add(c),
            remove: c => clases.delete(c),
            contains: c => clases.has(c),
        },
        get className() { return Array.from(clases).join(' '); },
        set className(v) { clases.clear(); String(v).split(/\s+/).filter(Boolean).forEach(c => clases.add(c)); },
        setAttribute: (k, v) => { attrs[k] = String(v); },
        getAttribute: k => (k in attrs ? attrs[k] : null),
        appendChild(c) { c.parent = el; el.children.push(c); return c; },
        remove() { if (el.parent) el.parent.children = el.parent.children.filter(x => x !== el); },
        // Acotados a los descendientes, como en el navegador: la capa busca sus
        // pilas y no las de nadie mas.
        querySelector(sel) { return descendientes(el).find(x => casa(x, sel)) || null; },
        querySelectorAll(sel) { return descendientes(el).filter(x => casa(x, sel)); },
        getBoundingClientRect() { return el._rect || { top: 0, bottom: 0, left: 0, right: 0, height: 0, width: 0 }; },
        set innerHTML(v) { if (v === '') el.children = []; },
        get innerHTML() { return ''; },
        _clases: clases, _attrs: attrs,
    };
    return el;
}
function descendientes(raiz, out) {
    out = out || [];
    raiz.children.forEach(c => { out.push(c); descendientes(c, out); });
    return out;
}
function casa(el, sel) {
    let m = sel.match(/^\.([\w-]+)\[([\w-]+)="([^"]*)"\]$/);
    if (m) return el._clases.has(m[1]) && el.getAttribute(m[2]) === m[3];
    m = sel.match(/^\.([\w-]+)$/);
    if (m) return el._clases.has(m[1]);
    return false;
}

function montarDom() {
    const body = Elem('body');
    const historyView = Elem('div'); historyView.id = 'history-view';
    const globalStack = Elem('div'); globalStack.id = 'event-toast-stack';
    body.appendChild(historyView);
    body.appendChild(globalStack);
    const porId = { 'history-view': historyView, 'event-toast-stack': globalStack };

    const document_ = {
        body,
        documentElement: { clientWidth: ANCHO, style: { setProperty() {} } },
        createElement: t => Elem(t),
        // Busca en el ARBOL, no en un mapa fijo: la capa de avisos se crea en
        // caliente con createElement+appendChild y tiene que poder encontrarse
        // despues, igual que en el navegador. Con un mapa, cada llamada creaba
        // una capa nueva y no se veia ni una sola pila.
        getElementById: id => porId[id] ||
            descendientes(body).find(e => e.id === id) || null,
        querySelector: sel => descendientes(body).find(e => casa(e, sel)) || null,
        querySelectorAll: sel => descendientes(body).filter(e => casa(e, sel)),
        _registrar: (id, el) => { porId[id] = el; },
    };
    return { body, historyView, globalStack, document_ };
}

function abrirVisor(dom) {
    const sandbox = {
        document: dom.document_,
        console: { warn() {}, log() {} },
        CSS: { escape: s => String(s) },
        escapeHtml: s => String(s == null ? '' : s),
        requestAnimationFrame: fn => fn(),   // sincrono: el guard mide al momento
        setTimeout: (fn) => 0,
        innerHeight: ALTO,
        addEventListener() {},
    };
    sandbox.window = sandbox;
    vm.createContext(sandbox);
    const ini = LIVE.indexOf('const _AVISO_CAPA_ID');
    const fin = LIVE.indexOf("// v455 · `matchId` (6º argumento)");
    if (ini === -1 || fin <= ini) return null;
    vm.runInContext(LIVE.slice(ini, fin) +
        '\n;globalThis.pilaDe   = _avisoPilaDe;' +
        '\n;globalThis.coloca   = _avisoColocaPilas;' +
        '\n;globalThis.capa     = _avisoCapa;' +
        '\n;globalThis.enLista  = _avisosEnListado;', sandbox);
    return sandbox;
}

// Crea una tarjeta en el listado, con su rectangulo.
function tarjeta(dom, id, top, alto) {
    const c = Elem('div');
    c.className = 'history-card';
    c.setAttribute('data-match-id', id);
    c._rect = { top: top, bottom: top + alto, left: 20, right: ANCHO - 20, height: alto, width: ANCHO - 40 };
    dom.historyView.appendChild(c);
    return c;
}
const avisoEn = (pila) => { const t = Elem('div'); t.className = 'event-toast'; pila.appendChild(t); return t; };

// ═══════════ PARTE 1 · una pila por partido ═══════════
console.log('\n── PARTE 1 · cada partido, su pila ──');
{
    const dom = montarDom();
    const S = abrirVisor(dom);
    ok('1a · el bloque de las pilas existe y se puede ejecutar', !!S);
    if (!S) { console.log('\nSin el bloque no hay nada que ejecutar.'); process.exit(1); }

    tarjeta(dom, 'alevin', 100, 200);
    tarjeta(dom, 'juvenil', 320, 200);

    const pA = S.pilaDe('alevin'), pJ = S.pilaDe('juvenil');
    ok('1b · dos partidos -> dos pilas distintas', !!pA && !!pJ && pA !== pJ);
    ok('1c · pedir la misma dos veces devuelve LA MISMA (no se duplica)',
       S.pilaDe('alevin') === pA);
    ok('1d · cada pila lleva su matchId', pA.getAttribute('data-match') === 'alevin' &&
       pJ.getAttribute('data-match') === 'juvenil');

    // B · los avisos de uno no acaban en la pila del otro.
    avisoEn(pA); avisoEn(pA); avisoEn(pJ);
    ok('1e · 🔑 los avisos van a la pila de SU partido, no a una común',
       pA.children.length === 2 && pJ.children.length === 1,
       'alevin=' + pA.children.length + ' juvenil=' + pJ.children.length);
}

// ═══════════ PARTE 2 · 🔑🔑 sobreviven al repintado de la lista ═══════════
console.log('\n── PARTE 2 · 🔑🔑 el repintado de la lista NO se lleva los avisos ──');
{
    const dom = montarDom();
    const S = abrirVisor(dom);
    tarjeta(dom, 'alevin', 100, 200);
    const p = S.pilaDe('alevin');
    avisoEn(p); avisoEn(p);

    ok('2a · la pila NO cuelga de la tarjeta (si colgara, moriría en el repintado)',
       dom.historyView.children.every(c => !descendientes(c).some(x => x._clases.has('lct-stack'))),
       'showLiveNow hace innerHTML="" en CADA latido de CUALQUIER partido');

    // El repintado real: se vacía el contenedor y se crean tarjetas NUEVAS.
    dom.historyView.children = [];
    tarjeta(dom, 'alevin', 140, 200);
    S.coloca();

    ok('2b · 🔑 tras repintar la lista, los avisos SIGUEN vivos',
       p.children.length === 2, 'quedaban ' + p.children.length);
    ok('2c · y la pila se re-alinea a la tarjeta NUEVA',
       p.style.top === Math.round(140 + 8) + 'px', 'top=' + p.style.top);
}

// ═══════════ PARTE 3 · alineada a su tarjeta ═══════════
console.log('\n── PARTE 3 · alineada a la altura de SU tarjeta ──');
{
    const dom = montarDom();
    const S = abrirVisor(dom);
    tarjeta(dom, 'alevin', 100, 200);
    tarjeta(dom, 'juvenil', 320, 220);
    const pA = S.pilaDe('alevin'), pJ = S.pilaDe('juvenil');
    avisoEn(pA); avisoEn(pJ);
    S.coloca();

    ok('3a · cada pila arranca a la altura de su tarjeta',
       pA.style.top === '108px' && pJ.style.top === '328px',
       'alevin=' + pA.style.top + ' juvenil=' + pJ.style.top);
    ok('3b · y no se solapan: la de abajo empieza más abajo',
       parseInt(pJ.style.top) > parseInt(pA.style.top));
    ok('3c · se pega al borde derecho de SU tarjeta, no al de la pantalla',
       pA.style.right === Math.round(ANCHO - (ANCHO - 20) + 8) + 'px', 'right=' + pA.style.right);
    ok('3d · el alto queda acotado por el de la tarjeta (no la desborda)',
       parseInt(pA.style.maxHeight) <= 200, 'maxHeight=' + pA.style.maxHeight);
    ok('3e · ninguna está en modo rescate: las dos tarjetas se ven',
       !pA.classList.contains('lct-rescate') && !pJ.classList.contains('lct-rescate'));
}

// ═══════════ PARTE 4 · 🔑 el rescate al borde ═══════════
console.log('\n── PARTE 4 · 🔑 la tarjeta fuera de pantalla: nada queda oculto ──');
{
    const dom = montarDom();
    const S = abrirVisor(dom);
    tarjeta(dom, 'alevin', 100, 200);
    const lejos = tarjeta(dom, 'cadete', 1400, 200);   // muy por debajo del viewport
    const pA = S.pilaDe('alevin'), pC = S.pilaDe('cadete');
    avisoEn(pA); avisoEn(pC);
    S.coloca();

    ok('4a · la tarjeta visible se alinea normal', !pA.classList.contains('lct-rescate'));
    ok('4b · 🔑 la tarjeta FUERA DE PANTALLA pasa a rescate (no se pierde el aviso)',
       pC.classList.contains('lct-rescate'), 'este es el punto 2 del reporte');
    ok('4c · y el rescatado se ancla al borde inferior, no a la nada',
       !!pC.style.bottom && pC.style.top === '', 'bottom=' + pC.style.bottom + ' top=' + pC.style.top);
    ok('4d · el aviso rescatado NO desaparece', pC.children.length === 1);

    // Al hacer scroll hasta la tarjeta, deja de estar rescatada.
    lejos._rect = { top: 300, bottom: 500, left: 20, right: ANCHO - 20, height: 200, width: ANCHO - 40 };
    S.coloca();
    ok('4e · al llegar a ella con el scroll, vuelve a alinearse a su tarjeta',
       !pC.classList.contains('lct-rescate') && pC.style.top === '308px', pC.style.top);

    // E · el umbral no es cero: una tarjeta asomando por el borde no vale.
    lejos._rect = { top: ALTO - 20, bottom: ALTO + 180, left: 20, right: ANCHO - 20, height: 200, width: ANCHO - 40 };
    S.coloca();
    ok('4f · ⚠️ una tarjeta apenas asomando NO cuenta como visible (saldría cortado)',
       pC.classList.contains('lct-rescate'),
       'con umbral 0 el aviso saldría medio fuera y daría la misma sensación de "no se ve"');

    // Varias rescatadas se apilan, no se pisan.
    const dom2 = montarDom();
    const S2 = abrirVisor(dom2);
    tarjeta(dom2, 'a', 2000, 200); tarjeta(dom2, 'b', 2300, 200); tarjeta(dom2, 'c', 2600, 200);
    const p1 = S2.pilaDe('a'), p2 = S2.pilaDe('b'), p3 = S2.pilaDe('c');
    avisoEn(p1); avisoEn(p2); avisoEn(p3);
    S2.coloca();
    const bottoms = [p1.style.bottom, p2.style.bottom, p3.style.bottom];
    ok('4g · tres rescatadas se escalonan en el borde (no una encima de otra)',
       new Set(bottoms).size === 3, JSON.stringify(bottoms));
}

// ═══════════ PARTE 5 · limpieza y bordes ═══════════
console.log('\n── PARTE 5 · limpieza ──');
{
    const dom = montarDom();
    const S = abrirVisor(dom);
    tarjeta(dom, 'alevin', 100, 200);
    const p = S.pilaDe('alevin');
    avisoEn(p);
    S.coloca();
    ok('5a · con avisos, la pila sigue en la capa', S.capa().children.length === 1);

    // Cuando el último aviso se va, la pila sobra.
    p.children = [];
    S.coloca();
    ok('5b · una pila vacía se retira (no deja cajas sueltas)',
       S.capa().children.length === 0);

    // F · fuera del listado no puede quedar ninguna.
    const dom3 = montarDom();
    const S3 = abrirVisor(dom3);
    tarjeta(dom3, 'alevin', 100, 200);
    const p3 = S3.pilaDe('alevin');
    avisoEn(p3);
    S3.coloca();
    ok('5c · en el listado hay pila', S3.capa().children.length === 1);
    dom3.historyView.offsetParent = null;      // se entra a un partido
    ok('5d · y el visor sabe que ya no está en el listado', S3.enLista() === false);
    S3.coloca();
    ok('5e · ⚠️ fuera del listado no queda ninguna pila (competirían con la del detalle)',
       S3.capa().children.length === 0);
}

// ═══════════ PARTE 6 · el enrutado en showEventToast ═══════════
// Esto no se puede ejecutar sin medio visor, así que se ancla estrecho.
console.log('\n── PARTE 6 · el enrutado del aviso ──');
{
    const ini = LIVE.indexOf('function showEventToast(');
    const bloque = LIVE.slice(ini, ini + 7000);

    ok('6a · en el LISTADO el aviso va a la pila de su partido',
       /_pilaPorTarjeta = \(_enListado && matchId\)\s*\n?\s*\? _avisoPilaDe\(matchId\)/.test(bloque),
       bloque.slice(0, 0));
    ok('6b · y sin matchId (o en el detalle) sigue yendo a la pila de siempre',
       /const stack = _pilaPorTarjeta \|\| document\.getElementById\("event-toast-stack"\)/.test(bloque));
    ok('6c · 🔑 el aviso rescatado LLEVA a su tarjeta al tocarlo',
       /lct-rescate[\s\S]{0,200}?_avisoIrATarjeta\(matchId\)/.test(bloque),
       'sin esto el rescate avisa pero no sirve de nada');
    ok('6d · se re-mide tras meter el aviso (la pila cambia de alto)',
       /_pilaPorTarjeta && typeof _avisoColocaPronto === 'function'/.test(bloque));

    // A · el enganche al repintado de la lista.
    ok('6e · ⚠️ el repintado de la lista vuelve a medir las pilas',
       /_avisoColocaPronto === 'function'\) _avisoColocaPronto\(\);\s*\n\s*\n?\s*\}; \/\/ fin _repintarLista/.test(LIVE),
       'sin esto las pilas señalarían a tarjetas que ya no existen');

    // La tarjeta tiene que decir de qué partido es, o no hay a qué alinear.
    ok('6f · la tarjeta del listado lleva su data-match-id',
       /card\.setAttribute\('data-match-id', m\.id \|\| ''\)/.test(LIVE));

    // Todas las vías de aviso pasan el matchId: si una no lo pasa, ese suceso
    // se va a la pila equivocada.
    const llamadas = LIVE.match(/showEventToast\(/g) || [];
    const conMatchId = LIVE.match(/showEventToast\([^;]*?matchId\s*\)/g) || [];
    ok('6g · ⚠️ TODAS las llamadas de detectAndAlert pasan el matchId',
       conMatchId.length >= llamadas.length - 2,
       llamadas.length + ' llamadas, ' + conMatchId.length + ' con matchId (la definición y la de eventos cuentan aparte)');
}

console.log('\n────────────────────────────────');
console.log('PASS: ' + pass + '   FAIL: ' + fail);
process.exit(fail === 0 ? 0 : 1);

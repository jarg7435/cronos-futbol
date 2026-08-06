// ═══════════════════════════════════════════════════════════════════════════
// GUARD · v457 — La pila de avisos cabe en la pantalla y se deja leer
// ═══════════════════════════════════════════════════════════════════════════
// Reporte del autor: al hacer un CAMBIO GRUPAL, la tarjeta de avisos flotantes
// es más larga que la pantalla del móvil y no se puede ver entera; como el
// aviso se va solo, no da tiempo a leer todos los cambios.
//
// Un cambio grupal emite UN AVISO POR PAREJA de jugadores (live.html los pinta
// uno a uno) y los siete de un grupal llegan en un ÚNICO snapshot, así que lo
// que se desborda es la PILA. Tres cosas tenían que fallar a la vez, y las tres
// se fijan aquí:
//
//   1 · EL TOPE DE ALTO ESTABA MAL MEDIDO. Era `calc(100vh - 120px)`, un número
//       que no descuenta de DÓNDE ARRANCA la pila (--toast-top, el borde
//       inferior medido del marcador, ~200px). La base caía por debajo del
//       borde de la pantalla: no se puede recorrer con scroll lo que está fuera
//       del área visible. Además iba en `vh`, que en iOS es mayor que lo
//       visible (misma trampa que v456).
//   2 · LOS AVISOS SE ENCOGÍAN EN VEZ DE DESBORDAR. En una columna flex con
//       tope de alto, los hijos se comprimen antes de que el `overflow` entre a
//       jugar: hace falta `flex-shrink: 0`.
//   3 · SE IBAN A MEDIA LECTURA, y deslizar para leerlos cerraba el de debajo.
//
// La PARTE 2 no comprueba texto: hace la ARITMÉTICA del tope contra el alto
// visible de cada dispositivo. Es la única forma de afirmar "la pila termina
// DENTRO de la pantalla", que es literalmente lo que fallaba.
// La PARTE 3 EJECUTA el ciclo de vida del aviso con un reloj controlado.
//
// Red-check: `CRONOS_LIVE_HTML=<ruta>` apunta a una copia mutada.
// ═══════════════════════════════════════════════════════════════════════════

'use strict';

const fs   = require('fs');
const path = require('path');
const vm   = require('vm');
const { simulador, TACTILES, RATON } = require('./_css_cascade.js');

const RAIZ = path.join(__dirname, '..');
const RUTA_LIVE = process.env.CRONOS_LIVE_HTML || path.join(RAIZ, 'live.html');
const LIVE = fs.readFileSync(RUTA_LIVE, 'utf8');

const SIM = simulador(LIVE);
const { v, calcula, aPixeles } = SIM;
const TODOS = TACTILES.concat(RATON);

let fallos = 0, total = 0;
function ok(nombre, cond, detalle) {
    total++;
    if (cond) { console.log(`  ✓ ${nombre}`); }
    else { console.log(`  ✗ ${nombre}${detalle ? '  → ' + detalle : ''}`); fallos++; }
}

// ───────────────────────────────────────────────────────────────────────────
console.log('\n── PARTE 1 · la pila es recorrible en TODOS los formatos ──');
// ───────────────────────────────────────────────────────────────────────────
for (const d of TODOS) {
    const tope = calcula('#event-toast-stack', d)['max-height'];
    ok(`1a · [${d.n}] la pila tiene tope de alto`, !!tope, 'sin max-height');
    ok(`1b · [${d.n}] 🔑 el tope DESCUENTA dónde arranca la pila (--toast-top)`,
       !!tope && /var\(\s*--toast-top/.test(tope.valor), tope ? tope.valor : '—');
    ok(`1c · [${d.n}] y se mide sobre el alto VISIBLE (dvh)`,
       !!tope && /dvh/.test(tope.valor), tope ? tope.valor : '—');
    ok(`1c2 · [${d.n}] con respaldo en vh para navegadores sin dvh`,
       !!tope && tope.valores.some(x => /vh/.test(x) && !/dvh/.test(x)),
       tope ? tope.valores.join(' → ') : '—');
    ok(`1d · [${d.n}] se puede recorrer (overflow-y auto)`,
       v('#event-toast-stack', 'overflow-y', d) === 'auto',
       String(v('#event-toast-stack', 'overflow-y', d)));
    ok(`1e · [${d.n}] 🔑 los avisos NO se encogen (si no, no hay scroll: se aplastan)`,
       v('.event-toast', 'flex-shrink', d) === '0',
       String(v('.event-toast', 'flex-shrink', d)));
    ok(`1f · [${d.n}] el gesto no arrastra la página de detrás`,
       String(v('#event-toast-stack', 'overscroll-behavior', d) || '').indexOf('contain') === 0,
       String(v('#event-toast-stack', 'overscroll-behavior', d)));
}

// ───────────────────────────────────────────────────────────────────────────
console.log('\n── PARTE 2 · ARITMÉTICA: la pila TERMINA dentro de la pantalla ──');
// ───────────────────────────────────────────────────────────────────────────
// No se mide texto, se calcula. `--toast-top` lo pone _posicionaAvisos con el
// borde inferior REAL del marcador, que varía con la cabecera y el formato, así
// que se prueban varias posiciones plausibles: la propiedad tiene que
// cumplirse para TODAS, no para una elegida a conveniencia.
const TOPES_PLAUSIBLES = [96, 140, 200, 260];
for (const d of TODOS) {
    const tope = v('#event-toast-stack', 'max-height', d);
    for (const toastTop of TOPES_PLAUSIBLES) {
        if (toastTop > d.alto - 60) continue;           // no cabría ni la cabecera
        let alto = NaN, err = '';
        try { alto = aPixeles(tope, { alto: d.alto, altoVh: d.altoVh, ancho: d.ancho, toastTop }); }
        catch (e) { err = e.message; }
        const base = toastTop + alto;
        ok(`2a · [${d.n}] con --toast-top=${toastTop}px la pila acaba dentro (${Math.round(base)} ≤ ${d.alto})`,
           isFinite(base) && base <= d.alto, err || (Math.round(base) + 'px'));
        // El sitio útil sólo se exige cuando la pila arranca en la mitad
        // superior de la pantalla, que es donde la deja el marcador. Si el
        // marcador ya ocupa el 60% del alto (un móvil apaisado con la cabecera
        // desplegada), no hay tope que pueda inventarse espacio.
        if (toastTop <= d.alto * 0.45) {
            ok(`2b · [${d.n}] …y deja sitio para leer (≥120px con --toast-top=${toastTop}px)`,
               isFinite(alto) && alto >= 120, err || (Math.round(alto) + 'px'));
        }
    }
}

// ───────────────────────────────────────────────────────────────────────────
console.log('\n── PARTE 3 · el aviso, EJECUTADO con reloj controlado ──');
// ───────────────────────────────────────────────────────────────────────────
function extraeFuncion(src, nombre) {
    const ini = src.indexOf('function ' + nombre + '(');
    if (ini < 0) throw new Error('No encontrada: ' + nombre);
    let i = src.indexOf('{', ini), prof = 0;
    for (; i < src.length; i++) {
        if (src[i] === '{') prof++;
        else if (src[i] === '}') { prof--; if (prof === 0) { i++; break; } }
    }
    return src.slice(ini, i);
}
// El bloque de "la pila se deja leer": desde la primera constante hasta el
// cierre de su IIFE. Se localiza por anclas reales y se comprueba que existan.
function extraeBloqueLectura(src) {
    const ini = src.indexOf('const _AVISOS_GRACIA_MS');
    const iife = src.indexOf('(function _pilaAvisosSeDejaLeer');
    if (ini < 0 || iife < 0) throw new Error('No encuentro el bloque de lectura de la pila');
    const fin = src.indexOf('})();', iife);
    if (fin < 0) throw new Error('No encuentro el cierre del IIFE de la pila');
    return src.slice(ini, fin + 5);
}

// Reloj de mentira: `avanza(ms)` dispara en orden los temporizadores vencidos.
function crearReloj() {
    let ahora = 0, sig = 1;
    const tareas = new Map();
    return {
        ahora: () => ahora,
        setTimeout(fn, ms) { const id = sig++; tareas.set(id, { t: ahora + (ms || 0), fn }); return id; },
        clearTimeout(id) { tareas.delete(id); },
        avanza(ms) {
            const fin = ahora + ms;
            for (;;) {
                let idMin = null, tMin = Infinity;
                for (const [id, t] of tareas) if (t.t <= fin && t.t < tMin) { tMin = t.t; idMin = id; }
                if (idMin === null) break;
                const tarea = tareas.get(idMin);
                tareas.delete(idMin);
                ahora = tarea.t;
                tarea.fn();
            }
            ahora = fin;
        }
    };
}

function crearEntorno() {
    const reloj = crearReloj();
    const oyentes = {};
    const nuevoNodo = (tag) => {
        const n = {
            tag, innerHTML: '', className: '', style: {}, children: [], quitado: false,
            clases: [],
            appendChild(c) { this.children.push(c); c.padre = this; },
            remove() { this.quitado = true; if (this.padre) this.padre.children = this.padre.children.filter(x => x !== this); },
            get firstChild() { return this.children[0]; },
        };
        n.classList = { add: (c) => n.clases.push(c), remove: () => {} };
        return n;
    };
    const pila = nuevoNodo('div');
    pila.addEventListener = (tipo, fn) => { (oyentes[tipo] = oyentes[tipo] || []).push(fn); };

    const sb = {
        console: { log() {}, warn() {} },
        Math, JSON, String, Object, Array, RegExp, Number, Boolean,
        Date: { now: () => reloj.ahora() },
        setTimeout: (fn, ms) => reloj.setTimeout(fn, ms),
        clearTimeout: (id) => reloj.clearTimeout(id),
        document: {
            createElement: nuevoNodo,
            getElementById: (id) => (id === 'event-toast-stack' ? pila : null),
        },
        EVENT_META: { sub: { icon: '🔄', cls: 'ev-sub', title: 'CAMBIO', flash: '#58a6ff', vib: 1 } },
        lastSnapshot: null,
        escapeHtml: (s) => String(s == null ? '' : s),
        _equipoDeSuceso: () => '',
        _chipEquipoHtml: () => '',
        _sinPrefijoEquipo: (t) => t,
        _etiquetaPartidoDe: () => '',
        _posicionaAvisos: () => {},
        _appendEventToHistoryPanel: () => {},
        _alertsMuted: true, vibrate: () => {}, playEventSound: () => {},
    };
    sb.window = sb;
    vm.createContext(sb);
    vm.runInContext(extraeBloqueLectura(LIVE) + '\n' + extraeFuncion(LIVE, 'showEventToast'), sb);

    return {
        sb, pila, reloj,
        // Dispara un evento sobre la pila COMO LO HARÍA EL NAVEGADOR: por los
        // oyentes que el propio código enganchó. Si alguien borra el enganche,
        // esto deja de tener efecto y las aserciones se ponen rojas — la lección
        // de v443: probar la máquina aislada no ve que esté DESCONECTADA.
        disparar(tipo, x, y) {
            (oyentes[tipo] || []).forEach(fn => fn({ clientX: x || 0, clientY: y || 0 }));
            return (oyentes[tipo] || []).length;
        },
        oyentes,
        avisa() { vm.runInContext('showEventToast("sub", "EQUIPO | SALE: A | ENTRA: B", "L vs V", "1T 20:00", "")', sb); },
        vivo() { return pila.children.length > 0 && !pila.children[0].clases.includes('leaving'); },
    };
}

// 3.1 · Sin nadie mirando, el aviso se va solo a los 8 s (lo de siempre).
{
    const e = crearEntorno();
    e.avisa();
    ok('3a · aparece el aviso', e.pila.children.length === 1);
    e.reloj.avanza(7000);
    ok('3b · a los 7 s sigue en pantalla', e.vivo());
    e.reloj.avanza(1500);
    ok('3c · a los 8 s se va solo (no se ha roto el comportamiento de siempre)', !e.vivo());
}

// 3.2 · 🔑 EL ARREGLO: mientras se lee la pila, NO se va.
{
    const e = crearEntorno();
    e.avisa();
    const enganchados = e.disparar('touchmove', 100, 100);
    ok('3d · la pila tiene oyentes enganchados de verdad', enganchados > 0,
       'sin enganche, el arreglo no llega al navegador');
    e.reloj.avanza(7500);
    e.disparar('touchmove', 100, 120);          // el usuario sigue deslizando
    e.reloj.avanza(2000);                        // pasa de los 8 s de vida
    ok('3e · 🔑 deslizando la pila, el aviso NO se cierra a los 8 s', e.vivo(),
       'era lo que impedía leer un cambio grupal entero');
    e.reloj.avanza(3000);                        // 2,5 s de gracia + margen
    ok('3f · y en cuanto se deja de leer, se va (no se queda pegado)', !e.vivo());
}

// 3.3 · El toque sigue cerrando…
{
    const e = crearEntorno();
    e.avisa();
    e.disparar('pointerdown', 200, 200);
    e.disparar('pointerup', 202, 201);           // 3px: es un toque
    e.pila.children[0].onclick();
    ok('3g · un toque limpio sigue cerrando el aviso', !e.vivo());
}

// 3.4 · …pero un DESLIZAMIENTO no es un toque.
{
    const e = crearEntorno();
    e.avisa();
    e.disparar('pointerdown', 200, 200);
    e.disparar('pointermove', 205, 260);         // 65px hacia abajo: es deslizar
    e.pila.children[0].onclick();
    ok('3h · 🔑 deslizar para leer NO cierra el aviso que hay debajo', e.vivo(),
       'sin esto, el dedo que va a recorrer los cambios cierra el primero');
}

// 3.5 · Un cambio grupal entero: todos los avisos siguen ahí mientras se lee.
{
    const e = crearEntorno();
    for (let i = 0; i < 7; i++) e.avisa();       // siete parejas, un solo snapshot
    ok('3i · los 7 avisos de un cambio grupal caben en la pila', e.pila.children.length === 7);
    // El usuario va recorriendo la lista: un gesto cada 2 s durante 6 s. La
    // gracia son 2,5 s desde el ÚLTIMO gesto, así que esto es "leyendo", no
    // "leyó una vez hace rato".
    e.reloj.avanza(6000);
    for (let i = 0; i < 3; i++) { e.disparar('scroll', 0, 0); e.reloj.avanza(2000); }
    const vivos = e.pila.children.filter(c => !c.clases.includes('leaving')).length;
    ok('3j · 🔑 recorriéndola, los 7 siguen ahí pasados los 8 s de vida',
       vivos === 7, vivos + ' vivos a los ' + e.reloj.ahora() + ' ms');
    e.reloj.avanza(4000);                        // deja de leer
    ok('3k · y cuando termina de leer, la pila se vacía sola',
       e.pila.children.filter(c => !c.clases.includes('leaving')).length === 0);
}

// ───────────────────────────────────────────────────────────────────────────
console.log('\n── PARTE 4 · lo que NO podía romperse por el camino ──');
// ───────────────────────────────────────────────────────────────────────────
// v422: la pila NO puede ser una franja del ancho completo, porque lleva
// `pointer-events:auto` (lo necesita para deslizarse) y su parte invisible se
// tragaba los toques sobre el campo. Se toca `pointer-events`, así que se fija.
for (const d of TACTILES) {
    const ancho = String(v('#event-toast-stack', 'width', d) || v('#event-toast-stack', 'max-width', d) || '');
    ok(`4a · [${d.n}] la pila sigue acotada de ancho (v422)`,
       /min\(\s*3[0-8]0px/.test(ancho), ancho || '—');
    ok(`4b · [${d.n}] y no se estira al borde izquierdo`,
       String(v('#event-toast-stack', 'left', d) || 'auto') === 'auto',
       String(v('#event-toast-stack', 'left', d)));
}
// v424: la pila cuelga del borde inferior MEDIDO del marcador.
ok('4c · la pila sigue colgando de --toast-top (medido, no clavado)',
   String(v('#event-toast-stack', 'top', TACTILES[0]) || '').indexOf('var(--toast-top') === 0,
   String(v('#event-toast-stack', 'top', TACTILES[0])));
ok('4d · y sigue siendo flotante sobre la vista',
   v('#event-toast-stack', 'position', TACTILES[0]) === 'fixed');

// ───────────────────────────────────────────────────────────────────────────
console.log('\n' + '─'.repeat(70));
console.log(`Resultado: ${total - fallos}/${total}`);
if (fallos) {
    console.log(`❌ ${fallos} aserción(es) en rojo`);
    process.exit(1);
}
console.log('✅ La pila de avisos cabe, se recorre y se deja leer');

// ═══════════════════════════════════════════════════════════════════════════
// GUARD · El marcador alineado con la línea de medio campo — v697
// ═══════════════════════════════════════════════════════════════════════════
// Reporte del autor (IMG_4716, móvil apaisado con los dos equipos sobre el
// campo): el botón GRUPAL del local se monta encima del cronómetro de la 2ª
// parte. Su criterio para el ajuste: desplazar el bloque del marcador a la
// derecha hasta que el «+» del local quede alineado con la línea de medio
// campo.
//
// ⚠️ POR QUÉ NO ES UN NÚMERO MÁGICO NI UN `grep`: el ancho del marcador
// depende del NOMBRE de los equipos ("ARINAGA REGIONAL" ocupa el triple que
// "LOCAL"), de los dígitos del resultado y del tamaño de letra del aparato.
// La función mide el DOM, así que el guard le da geometrías y comprueba el
// desplazamiento que calcula — incluido el caso en que hay que quedarse corto
// para no echar un botón fuera de la pantalla.
//
// LO QUE NO PUEDE VER: si en el móvil real queda bonito. Eso, la pantalla.
// ═══════════════════════════════════════════════════════════════════════════
'use strict';

const fs   = require('fs');
const path = require('path');
const vm   = require('vm');
const { execFileSync } = require('child_process');

const RAIZ = path.join(__dirname, '..');
const leer = f => fs.readFileSync(path.join(RAIZ, f), 'utf8');

let fallos = 0, total = 0;
function ok(nombre, cond) {
    total++;
    if (cond) console.log(`  ✓ ${nombre}`);
    else { console.log(`  ✗ ${nombre}`); fallos++; }
}

try {
    execFileSync(process.execPath, ['--check', path.join(RAIZ, 'js/ui/render.js')], { stdio: 'pipe' });
    ok('js/ui/render.js compila (node --check)', true);
} catch (e) { ok('js/ui/render.js compila (node --check)', false); }

const render = leer('js/ui/render.js');

// Extrae la función por su asignación a window, emparejando llaves.
function extrae(src, nombre) {
    const start = src.indexOf('window.' + nombre + ' = function');
    if (start < 0) return null;
    let i = src.indexOf('{', start), depth = 0;
    for (; i < src.length; i++) {
        if (src[i] === '{') depth++;
        else if (src[i] === '}') { depth--; if (depth === 0) { i++; break; } }
    }
    return src.slice(start, i) + ';';
}
const fuente = extrae(render, 'cronosAlineaMarcador');
ok('render.js expone cronosAlineaMarcador', !!fuente);

// ── Escenario: geometrías de un móvil apaisado de 844 px ────────────────────
//   campo  : 30 … 810   → línea de medio campo en 420
//   marcador centrado: 272 … 572
//   «+» del local: 380 … 408 → su centro, en 394
//   ⇒ hay que empujar 26 px a la derecha
function monta(op) {
    const o = Object.assign({
        // Móvil apaisado: el aparato del reporte (844 × 390).
        ancho: 844, alto: 390, hideVisitor: false,
        pitchLeft: 30, pitchWidth: 780,
        masLeft: 380, masWidth: 28,
        areaLeft: 272, areaWidth: 300
    }, op || {});

    const estado = { transform: '' };
    const desplazamiento = () => {
        const m = /\+\s*(-?\d+)px/.exec(estado.transform || '');
        return m ? parseInt(m[1], 10) : 0;
    };
    const rect = (left, width) => {
        const d = desplazamiento();
        return { left: left + d, right: left + width + d, width, top: 0, bottom: 0, height: 10 };
    };

    const mas   = { getBoundingClientRect: () => rect(o.masLeft, o.masWidth) };
    const pitch = { getBoundingClientRect: () => ({ left: o.pitchLeft, right: o.pitchLeft + o.pitchWidth,
                                                    width: o.pitchWidth, top: 0, bottom: 0, height: 300 }) };
    const area = {
        style: { set transform(v) { estado.transform = v; }, get transform() { return estado.transform; } },
        getBoundingClientRect: () => rect(o.areaLeft, o.areaWidth),
        querySelector: sel => (/success/.test(sel) ? mas : null)
    };

    const clases = new Set(o.hideVisitor ? ['hide-visitor'] : []);
    const ctx = {
        console,
        window: {
            innerWidth: o.ancho,
            // 🔑 Las media queries se EVALÚAN contra el tamaño del aparato, no
            // se responden con un booleano de conveniencia: es justo el corte
            // (`max-width` vs el lado corto) lo que estaba mal y hay que medir.
            matchMedia: (q) => {
                let m = true;
                const maxW = /max-width\s*:\s*(\d+)px/.exec(q);
                const maxH = /max-height\s*:\s*(\d+)px/.exec(q);
                const minW = /min-width\s*:\s*(\d+)px/.exec(q);
                if (maxW && !(o.ancho <= +maxW[1])) m = false;
                if (maxH && !(o.alto  <= +maxH[1])) m = false;
                if (minW && !(o.ancho >= +minW[1])) m = false;
                return { matches: m };
            },
            addEventListener: () => {}
        },
        document: {
            body: { classList: { contains: c => clases.has(c) } },
            querySelector: sel => (sel === '.score-area' ? area : null),
            getElementById: id => (id === 'football-pitch' ? pitch : null)
        },
        Math
    };
    ctx.window.window = ctx.window;
    vm.createContext(ctx);
    vm.runInContext(fuente, ctx);
    return { ctx, estado, clases, llama: () => ctx.window.cronosAlineaMarcador() };
}

if (fuente) {
    // ── El caso reportado ───────────────────────────────────────────────────
    const e = monta();
    e.llama();
    ok('en móvil y con los dos equipos, empuja el marcador a la derecha',
       /translateX\(calc\(-50% \+ 26px\)\)/.test(e.estado.transform));

    // 🔑 El empuje es MEDIDO: con un marcador más ancho (equipo de nombre
    // largo) el «+» cae en otro sitio y el desplazamiento cambia solo. Un
    // número fijo en el CSS habría encajado en una captura y en ninguna más.
    const largo = monta({ masLeft: 330, areaLeft: 200, areaWidth: 420 });
    largo.llama();
    ok('con un marcador más ancho, el empuje se recalcula (no es un valor fijo)',
       /\+ 76px/.test(largo.estado.transform));

    // ── El tope: nunca sacar un botón de la pantalla ────────────────────────
    // El bloque llega hasta 830 en una pantalla de 844: sólo caben 8 px.
    const apretado = monta({ areaLeft: 500, areaWidth: 330 });
    apretado.llama();
    ok('si no cabe el empuje entero, se recorta para que el bloque siga dentro',
       /\+ 8px/.test(apretado.estado.transform));

    const pegado = monta({ areaLeft: 520, areaWidth: 324 });   // right = 844, sin hueco
    pegado.llama();
    ok('sin hueco a la derecha no se empuja nada (se queda centrado)',
       pegado.estado.transform === 'translateX(-50%)');

    // ── Dónde NO debe tocar ─────────────────────────────────────────────────
    const soloYo = monta({ hideVisitor: true });
    soloYo.llama();
    ok('con UN SOLO equipo (hide-visitor) el marcador se queda centrado',
       soloYo.estado.transform === 'translateX(-50%)');

    // ── PC e iPad: CENTRADO, sin tocar (encargo del 12/09 tarde) ────────────
    // 🚨 El corte anterior era `max-width: 950px` y metía dentro al iPad EN
    // VERTICAL (820 px de ancho), al que el autor quiere centrado. La pantalla
    // pequeña se reconoce por su lado CORTO, no por el ancho.
    const pc = monta({ ancho: 1920, alto: 1080 });
    pc.llama();
    ok('PC (1920×1080): el marcador se queda centrado',
       pc.estado.transform === 'translateX(-50%)');

    const ipadV = monta({ ancho: 820, alto: 1180 });
    ipadV.llama();
    ok('iPad VERTICAL (820×1180): centrado — el caso que el corte viejo rompía',
       ipadV.estado.transform === 'translateX(-50%)');

    const ipadH = monta({ ancho: 1180, alto: 820 });
    ipadH.llama();
    ok('iPad APAISADO (1180×820): centrado',
       ipadH.estado.transform === 'translateX(-50%)');

    // ── Móvil, en las dos orientaciones: sí se ajusta ───────────────────────
    const movilV = monta({ ancho: 390, alto: 844, pitchLeft: 10, pitchWidth: 370,
                           masLeft: 170, masWidth: 20, areaLeft: 60, areaWidth: 270 });
    movilV.llama();
    ok('móvil VERTICAL (390×844): sí se ajusta',
       /translateX\(calc\(-50% \+ \d+px\)\)/.test(movilV.estado.transform));

    // ── No acumula, y sabe VOLVER ───────────────────────────────────────────
    // 🚨 Sin restablecer el centrado ANTES de medir, cada repintado sumaría
    // sobre el anterior y el marcador se iría escapando por la derecha.
    const rep = monta();
    rep.llama(); rep.llama(); rep.llama();
    ok('tres repintados dan el MISMO desplazamiento (no se acumula)',
       /\+ 26px/.test(rep.estado.transform));

    // Y si el partido pasa a un solo equipo, el ajuste tiene que deshacerse:
    // esto es lo que exige restablecer el transform al principio de la función.
    const vuelve = monta();
    vuelve.llama();
    vuelve.clases.add('hide-visitor');
    vuelve.llama();
    ok('al quedarse un solo equipo, el marcador VUELVE a su sitio',
       vuelve.estado.transform === 'translateX(-50%)');

    // ── Alineación real: el «+» acaba en la línea de medio campo ────────────
    const fin = monta();
    fin.llama();
    const d = parseInt(/\+ (\d+)px/.exec(fin.estado.transform)[1], 10);
    ok('📏 tras el ajuste, el centro del «+» coincide con el medio campo',
       (380 + d) + 28 / 2 === 30 + 780 / 2);
}

// El ajuste se dispara desde renderPlayers y al cambiar el ancho disponible
// (girar el aparato no repinta las fichas).
ok('se llama desde renderPlayers()', /cronosAlineaMarcador\(\);/.test(render));
ok('…y se reajusta al girar o redimensionar',
   /addEventListener\('resize'/.test(render) && /orientationchange/.test(render));

console.log(`\n  ${total - fallos}/${total} aserciones`);
process.exit(fallos ? 1 : 0);

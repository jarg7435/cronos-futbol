// ─────────────────────────────────────────────────────────────────────────
// test_visor_cabe_en_pantalla.js · v571
//
// EL FALLO (capturas 9213/9214, prueba de 7 partidos, 2026-08-18):
//   "cuando se despliega el historial de sucesos se abre empujando o tapando
//    hacia arriba, descuadra la pantalla y oculta la parte superior del campo
//    (escondiendo elementos tan importantes como el marcador)".
//
// 🔑 NO LO CAUSABA EL CAJÓN. Lo causaba `body { min-height: 100vh }`: con
// `min-height` el documento puede CRECER por debajo del viewport, así que todo
// lo que no cabía lo empujaba y la página scrolleaba — en la captura 9214, con
// el cajón PLEGADO, la cabecera ya estaba fuera. El cajón sólo lo hacía obvio.
//
// ⚠️ Y la regla correcta YA EXISTÍA, encerrada en
// `@media (orientation: landscape) and (max-width: 950px)`. El móvil tumbado
// bloqueaba el alto al viewport; el PC no. De ahí "en el PC sí, en las tablets
// no" — otra vez un síntoma que parece del dispositivo y es de una regla.
//
// Lo mismo con `#live-pitch`: las CUATRO reglas de los media queries móviles
// llevaban `max-height:100%` (una lo dice literalmente: "para no desbordar el
// viewport") y la regla BASE —la única que usa un PC— se quedó sin ella.
// ─────────────────────────────────────────────────────────────────────────
const fs   = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
let fail = 0, pass = 0;
const ok = (n, c, extra) => {
    if (c) { pass++; console.log('PASS ' + n); }
    else { fail++; console.log('FAIL ' + n); if (extra !== undefined) console.log('       ' + extra); }
};
const LIVE = fs.readFileSync(path.join(ROOT, 'live.html'), 'utf8').replace(/\r\n/g, '\n');

// Recorta una regla CSS `selector { … }` contando llaves. Devuelve el cuerpo.
// ⚠️ Sin comentarios: varias explicaciones de este fichero citan las propias
// propiedades que se comprueban ("max-height: 100%"), y un `.test()` sobre el
// texto crudo casaría el comentario en vez de la declaración. Es la trampa que
// ya ha dado guards verdes sobre defectos reales en este proyecto.
function regla(css, selector, desde) {
    const i = css.indexOf(selector + ' {', desde || 0);
    if (i < 0) return null;
    const ini = css.indexOf('{', i);
    let prof = 0;
    for (let k = ini; k < css.length; k++) {
        if (css[k] === '{') prof++;
        else if (css[k] === '}') {
            if (--prof === 0) {
                return css.slice(ini + 1, k)
                          .replace(/\/\*[\s\S]*?\*\//g, '')   // fuera comentarios
                          .trim();
            }
        }
    }
    return null;
}

console.log('── v571 · el visor en vivo cabe en la pantalla ──\n');

// ═══════════════════════════════════════════════════════════════════════════
console.log('── PARTE 1 · el body no puede crecer por debajo del viewport ──');
{
    const body = regla(LIVE, 'body');
    ok('1a · se recorta la regla base de body', !!body);
    if (body) {
        ok('1b · 🔑🔑🔑 el alto queda FIJADO al viewport, no es un mínimo',
           /height:\s*100dvh/.test(body) && !/min-height:\s*100vh/.test(body),
           'con min-height:100vh el documento crece y la cabecera se va por arriba: ' + body);
        ok('1c · con respaldo en 100vh para navegadores sin dvh',
           /height:\s*100vh/.test(body));
        ok('1d · 🔑 y no desborda: el scroll lo pone cada vista, no el documento',
           /overflow:\s*hidden/.test(body));
        ok('1e · sigue siendo una columna flex (cabecera → marcador → campo → cajón)',
           /display:\s*flex/.test(body) && /flex-direction:\s*column/.test(body));
    }
}

// ═══════════════════════════════════════════════════════════════════════════
console.log('\n── PARTE 2 · el campo cede altura en vez de desbordar ──');
{
    const pitch = regla(LIVE, '#live-pitch');
    ok('2a · se recorta la regla BASE de #live-pitch (la que usa el PC)', !!pitch);
    if (pitch) {
        ok('2b · 🔑🔑🔑 la regla base tiene max-height: era lo único que faltaba',
           /max-height:\s*100%/.test(pitch),
           'sin él, aspect-ratio calcula el alto desde el ANCHO y desborda: ' + pitch);
        ok('2c · y puede encogerse de verdad dentro del flex',
           /min-height:\s*0/.test(pitch) && /flex-shrink:\s*1/.test(pitch));
        ok('2d · conserva el aspect-ratio como forma NATURAL del campo',
           /aspect-ratio:\s*3\s*\/\s*2/.test(pitch),
           'sólo se comprime cuando falta alto; con espacio de sobra sigue 3:2');
    }
}

// ═══════════════════════════════════════════════════════════════════════════
console.log('\n── PARTE 3 · la cabecera no se mueve: quien cede es el campo ──');
{
    const main   = regla(LIVE, '#live-main');
    const barra  = regla(LIVE, '#match-events-bar');
    const wrap   = regla(LIVE, '#field-wrap');
    ok('3a · #live-main absorbe el espacio sobrante (flex:1)',
       !!main && /flex:\s*1/.test(main), main);
    ok('3b · 🔑 el cajón NO se encoge: se lleva su sitio y el campo cede el suyo',
       !!barra && /flex-shrink:\s*0/.test(barra), barra);
    ok('3c · #field-wrap puede encogerse por debajo de su contenido',
       !!wrap && /min-height:\s*0/.test(wrap), wrap);

    // El ORDEN en el DOM es lo que hace que el cajón quede abajo y la cabecera
    // arriba. Si alguien lo reordenara, el cajón taparía el marcador otra vez.
    const iHead  = LIVE.indexOf('<header id="live-header"');
    const iScore = LIVE.indexOf('<div id="scoreboard"');
    const iMain  = LIVE.indexOf('<div id="live-main"');
    const iBar   = LIVE.indexOf('<div id="match-events-bar"');
    ok('3d · 🔑 orden en el DOM: cabecera → marcador → campo → cajón',
       iHead > 0 && iHead < iScore && iScore < iMain && iMain < iBar,
       [iHead, iScore, iMain, iBar].join(' / '));
}

// ═══════════════════════════════════════════════════════════════════════════
console.log('\n── PARTE 4 · nada queda fuera de alcance por el overflow:hidden ──');
{
    // ⚠️ LA LECCIÓN DE LA CASILLA DEL RGPD: no estaba oculta, estaba FUERA del
    // viewport. Al fijar el alto del body, toda vista con contenido largo
    // necesita scroll PROPIO o se vuelve inalcanzable.
    const auth = regla(LIVE, '#auth-overlay');
    ok('4a · 🔑 el panel de acceso tiene scroll propio',
       !!auth && /overflow-y:\s*auto/.test(auth),
       'sin él, en una pantalla baja el botón ENTRAR queda fuera y sin salida');

    const lista = regla(LIVE, '#history-list');
    ok('4b · el listado de partidos tiene scroll propio',
       !!lista && /overflow-y:\s*auto/.test(lista), lista);

    const sucesos = regla(LIVE, '#match-events-list');
    ok('4c · el cajón de sucesos tiene alto acotado y scroll propio',
       !!sucesos && /overflow-y:\s*auto/.test(sucesos) && /height:\s*\d+px/.test(sucesos),
       'un cajón que creciera con el nº de sucesos se comería el campo poco a poco');

    ok('4d · en pantallas bajas el acceso se alinea arriba (no se recorta)',
       /@media \(max-height: 620px\)[\s\S]{0,160}#auth-overlay[\s\S]{0,80}align-items:\s*flex-start/.test(LIVE));
}

console.log('\n' + pass + ' PASS / ' + fail + ' FAIL');
process.exit(fail === 0 ? 0 : 1);

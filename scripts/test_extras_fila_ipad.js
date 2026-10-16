// ═══════════════════════════════════════════════════════════════════════════
// GUARD · 📟 v820 · iPad: los extras en UNA fila de esquina a esquina
// ═══════════════════════════════════════════════════════════════════════════
// Encargo del autor (implementar.txt 16-10, IMG_0631, iPad apaisado): R/P iba
// centrada bajo el campo y los avanzados pegados a su derecha → el conjunto
// quedaba descentrado y se salía por la esquina derecha. Ahora todos los
// bloques reparten el ancho del campo, del borde izquierdo al derecho, con el
// mismo hueco. Sólo 951-1366 px; móvil y PC no cambian.
//
// ⚠️ EJECUTA el cálculo real (lección de v679).
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

const PR  = leer('js/match/events/possession-tracker.js');
const SAV = leer('js/match/events/advanced-stats.js');

// Saca la función pura y la ejecuta aislada (con su ayudante `_suma`).
function cargaFila() {
    const ini = PR.indexOf('var HUECO_MIN');
    const fin = PR.indexOf('// Anchos de los bloques de una barra');
    const ctx = { window: {}, Math };
    vm.createContext(ctx);
    vm.runInContext(PR.slice(ini, fin), ctx);
    return ctx.window.cronosExtrasFilaTablet;
}
const F = cargaFila();
ok('possession-tracker.js expone el reparto de iPad', typeof F === 'function');

// Medidas de un iPad Air apaisado (1180×820): campo de 221 a 943 bajo la
// cabecera; R, 📊, P, F-D y CÓR, FAL, CEN, OCA, 📈 con sus anchos reales.
const campo = { left: 221, right: 943, top: 145, bottom: 600 };
const pr  = { anchos: [62, 46, 62, 54], h: 44 };
const sav = { anchos: [90, 90, 48, 90, 40], h: 54 };
const m = { ancho: 1180, alto: 820, seguro: 0, campo, pr, sav };

console.log('\n── 1 · la fila de iPad ──');
{
    const r = F(m);
    ok('hay reparto en iPad con las dos barras', !!r);
    const finSav = r.sav.left + r.sav.w;
    ok('🔴 el primer bloque (R) empieza en la esquina IZQUIERDA del campo',
       Math.abs(r.pr.left - campo.left) <= 1, 'left=' + r.pr.left);
    ok('🔴 el último bloque (📈) acaba en la esquina DERECHA del campo',
       Math.abs(finSav - campo.right) <= 1, 'fin=' + finSav);
    // El hueco entre P/F-D y CÓR es el mismo que dentro de cada barra.
    const huecoEntre = r.sav.left - (r.pr.left + r.pr.w);
    ok('el hueco entre las dos barras es el mismo que entre bloques',
       Math.abs(huecoEntre - r.gap) <= 1, 'entre=' + huecoEntre + ' gap=' + r.gap);
    ok('…y es positivo y razonable (bloques repartidos, no apiñados)', r.gap >= 6);
    ok('las dos barras en la MISMA línea (centradas en vertical)',
       Math.abs((r.pr.top + pr.h / 2) - (r.sav.top + sav.h / 2)) <= 1);
    ok('debajo del rectángulo verde, sin salirse de la pantalla',
       r.pr.top > campo.bottom && r.sav.top > campo.bottom && r.sav.top + sav.h <= m.alto);
}

console.log('\n── 2 · cuándo NO se reparte ──');
ok('móvil (≤950) → no: sigue con sus columnas', F(Object.assign({}, m, { ancho: 852 })) === null);
ok('PC (>1366) → no: sigue como estaba', F(Object.assign({}, m, { ancho: 1920 })) === null);
ok('sólo una barra encendida → no (esa se queda centrada)',
   F(Object.assign({}, m, { sav: { anchos: [], h: 0 } })) === null);
ok('sin campo medido → no', F(Object.assign({}, m, { campo: null })) === null);

console.log('\n── 3 · campo estrecho: no caben ──');
{
    const estrecho = { left: 400, right: 800, top: 100, bottom: 500 };
    const r = F(Object.assign({}, m, { campo: estrecho }));
    const totalFila = r.sav.left + r.sav.w - r.pr.left;
    ok('hueco mínimo de 6 px', r.gap === 6);
    ok('la fila queda CENTRADA bajo el campo',
       Math.abs((r.pr.left + totalFila / 2) - 600) <= 1, 'centro=' + (r.pr.left + totalFila / 2));
}

console.log('\n── 4 · las dos barras usan la misma cuenta ──');
ok('R/P se coloca con la fila de iPad', /window\.cronosExtrasMideFila\(\)/.test(PR.slice(PR.indexOf('function _colocaBarra()'))));
ok('avanzados también', /window\.cronosExtrasMideFila\(\)/.test(SAV.slice(SAV.indexOf('function _colocaBarra()'))));
ok('fuera de la fila se devuelve el hueco del CSS (móvil y PC intactos)',
   /barra\.style\.gap = '';/.test(PR) && /barra\.style\.gap = '';/.test(SAV));
ok('en la fila el separador de avanzados se oculta',
   /#cronos-sav-bar\.reparto \.sav-sep\{display:none;\}/.test(SAV));

console.log(`\n${total - fallos}/${total} OK`);
process.exit(fallos ? 1 : 0);

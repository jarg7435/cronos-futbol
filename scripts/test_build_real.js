// ─────────────────────────────────────────────────────────────────────────
//  test_build_real.js  ·  v751 (Fase 0, 2026-09-22)
//
//  EL BUILD TIENE QUE PODER DECIR QUE NO.
//
//  `npm run build` era `echo TODO && exit 0`: un verde permanente. Lo señaló
//  el dictamen de auditoría del 22-09 con un 4,5/10 en «calidad de entrega», y
//  tenía razón — mientras eso estuviera ahí, cualquiera que hiciera lo
//  razonable («compila antes de subir») recibía un OK que no significaba nada.
//
//  🔑 LO QUE VIGILA ESTE GUARD NO ES QUE EL BUILD EXISTA, ES QUE CORTE. Un
//  build que existe y siempre sale con 0 es peor que no tener build: el
//  anterior salía con 0 y nadie lo miró en meses. Por eso las aserciones que
//  importan son EJECUTADAS y en ROJO: se le da a cada comprobador una entrada
//  rota de verdad y se exige que se queje.
//
//  ⚠️ LO QUE ESTE GUARD **NO** HACE: lanzar `scripts/build.js` entero. Tarda
//  ~16 s y la batería ya tarda ~150 s; además `npm run build` corre ahora
//  antes de CADA despliegue, así que su paso en verde se comprueba solo, de
//  verdad y con el artefacto real, varias veces al día. Aquí se comprueban las
//  dos cosas que eso no demuestra: que los comprobadores saben ponerse en rojo,
//  y que build.js los llama a todos y propaga el fallo.
//
//  ⚠️ Las entradas rotas se fabrican en el directorio temporal del sistema,
//  NUNCA dentro del proyecto: un guard que ensucia el repositorio para probar
//  algo deja el repositorio sucio el día que se caiga a mitad.
// ─────────────────────────────────────────────────────────────────────────
'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const cp = require('child_process');

const ROOT = path.join(__dirname, '..');
const leer = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');

let pass = 0, fail = 0;
const ok = (n, cond, extra) => {
    if (cond) { pass++; console.log('  ✓ ' + n); }
    else { fail++; console.log('  ✗ ' + n); if (extra !== undefined) console.log('      → ' + String(extra).slice(0, 400)); }
};

const correr = (args) => {
    const r = cp.spawnSync(process.execPath, args, { cwd: ROOT, encoding: 'utf8' });
    return { code: r.status, salida: (r.stdout || '') + (r.stderr || '') };
};

// Cada fichero temporal lleva el pid: dos ejecuciones a la vez no se pisan.
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'cronos_build_' + process.pid + '_'));
const temporal = (nombre, contenido) => {
    const p = path.join(TMP, nombre);
    fs.writeFileSync(p, contenido, 'utf8');
    return p;
};
const limpiar = () => { try { fs.rmSync(TMP, { recursive: true, force: true }); } catch (_) { /* da igual */ } };

const PKG   = JSON.parse(leer('package.json').replace(/^\uFEFF/, ''));
const BUILD = leer('scripts/build.js');

console.log('\n══ v751 · el build es real: sabe decir que NO ══');

// ════════════════════════════════════════════════════════════════════
console.log('\n1) 🧨 Se acabó el `echo TODO && exit 0`');
{
    const s = PKG.scripts || {};

    ok('1a · 🔑🔑 `build` ya NO es un verde permanente',
       !/echo\s+TODO/.test(s.build || '') && !/exit\s+0/.test(s.build || ''),
       s.build);

    ok('1b · y apunta al validador de verdad',
       /scripts[\/\\]build\.js/.test(s.build || ''), s.build);

    ok('1c · existe `verify` para build + pruebas de una vez',
       /run build/.test(s.verify || '') && /test/.test(s.verify || ''), s.verify);

    // 🔑 SI EL BUILD NO ESTÁ EN EL CAMINO DEL DESPLIEGUE, NO SIRVE DE NADA.
    //    Un validador que hay que acordarse de lanzar es un validador que no
    //    se lanza justo el día que habría cazado algo.
    ok('1d · 🔑🔑 `deploy:staging` pasa por el build',
       /npm run build/.test(s['deploy:staging'] || ''), s['deploy:staging']);

    ok('1e · 🔑🔑 y `deploy:prod` también',
       /npm run build/.test(s['deploy:prod'] || ''), s['deploy:prod']);
}

// ════════════════════════════════════════════════════════════════════
console.log('\n2) 🧱 build.js llama a TODO y propaga el fallo');
{
    ok('2a · build.js compila',
       correr(['--check', path.join(ROOT, 'scripts', 'build.js')]).code === 0);

    for (const [quien, patron] of [
        ['la sintaxis de js/',            /_check_syntax\.js/],
        ['el JS embebido de los HTML',    /_check_html_inline_js\.js/],
        ['los sellos de versión',         /cache-bust\.js'\),\s*'--check'/],
    ]) {
        ok('2b · comprueba ' + quien, patron.test(BUILD));
    }

    ok('2c · comprueba el Service Worker y el backend',
       /'sw\.js'/.test(BUILD) && /'firebase-messaging-sw\.js'/.test(BUILD) &&
       /'functions', 'index\.js'/.test(BUILD));

    ok('2d · comprueba el precache del SW contra el disco (v452: addAll es atómico)',
       /const ASSETS = \[/.test(BUILD) && /precache/.test(BUILD));

    ok('2e · comprueba el manifiesto de la PWA',
       /manifest\.json/.test(BUILD) && /start_url/.test(BUILD));

    // 🔑🔑 LA ASERCIÓN QUE SOSTIENE LAS DEMÁS. Sin esto, build.js podría
    //    imprimir ocho cruces preciosas y salir con 0, que es literalmente lo
    //    que hacía el build anterior.
    ok('2f · 🔑🔑 si algo falla, SALE CON 1',
       /if \(fallos\)/.test(BUILD) && /process\.exit\(1\)/.test(BUILD),
       'un build que se queja y sale con 0 es el mismo verde permanente de antes');

    // ⚠️ SE CUENTA CONTRA EL TOTAL QUE EL PROPIO BUILD DECLARA, no contra un
    //    número escrito aquí. La primera versión fijaba «8» literal y se puso
    //    roja al AÑADIR la novena comprobación — castigaba la mejora, que es
    //    justo lo contrario de lo que vigila. Es la tercera vez esta semana
    //    que una aserción mide una constante en vez de una propiedad.
    {
        const pasos = BUILD.match(/paso\('(\d)\/(\d)/g) || [];
        const total = pasos.length ? Number(pasos[0].match(/\/(\d)/)[1]) : 0;
        ok('2g · las ' + total + ' comprobaciones declaradas siguen estando (no se ha vaciado ninguna)',
           total > 0 && pasos.length === total &&
           pasos.every((p) => Number(p.match(/\/(\d)/)[1]) === total),
           { declaradas: total, encontradas: pasos.length });
    }
}

// ════════════════════════════════════════════════════════════════════
console.log('\n3) 🔴 EJECUTADO: los comprobadores saben ponerse en ROJO');
{
    // ── El de la sintaxis de js/ ──
    const jsRoto = temporal('roto.js', 'const a = `sin cerrar;\nfunction x( {\n');
    const rSint = correr([path.join('scripts', '_check_syntax.js'), jsRoto]);
    ok('3a · 🔴 `_check_syntax.js` con un fichero roto → sale con 1',
       rSint.code === 1 && /ERR/.test(rSint.salida), 'code=' + rSint.code);

    const jsBueno = temporal('bueno.js', 'const a = 1;\nfunction x() { return a; }\n');
    ok('3b · …y con uno sano → sale con 0',
       correr([path.join('scripts', '_check_syntax.js'), jsBueno]).code === 0);

    // ── El del JS embebido ──
    // v751 · Éste sólo miraba el PRIMER <script> del fichero, así que un error
    // en el segundo pasaba de largo. Por eso el HTML de prueba pone el bueno
    // DELANTE: si alguien volviera al `match()` sin /g, esta aserción cae.
    const htmlRoto = temporal('roto.html',
        '<html><body>\n<script>var ok = 1;</script>\n' +
        '<script>function mal( { return;</script>\n</body></html>\n');
    const rEmb = correr([path.join('scripts', '_check_html_inline_js.js'), htmlRoto]);
    ok('3c · 🔴🔴 el JS embebido roto en el SEGUNDO <script> → sale con 1',
       rEmb.code === 1 && /ERR/.test(rEmb.salida),
       'code=' + rEmb.code + ' — si pasa en verde, ha vuelto a mirar sólo el primero');

    const htmlBueno = temporal('bueno.html',
        '<html><body>\n<script>var a = 1;</script>\n<script type="module">export const b = 2;</script>\n</body></html>\n');
    ok('3d · …y con los dos sanos → sale con 0 (y el módulo se valida como módulo)',
       correr([path.join('scripts', '_check_html_inline_js.js'), htmlBueno]).code === 0);

    // Un <script> citado dentro de un comentario HTML no es código: index.html
    // tiene uno en la línea 1873 y la primera versión del comprobador dio ERR
    // sobre una frase en castellano.
    const htmlComentado = temporal('comentado.html',
        '<html><body>\n<script>var a = 1;</script>\n' +
        '<!-- aquí vivía el <script> de una librería, con un ( sin cerrar -->\n</body></html>\n');
    ok('3e · 🔑 un `<script>` dentro de un comentario HTML NO se toma por código',
       correr([path.join('scripts', '_check_html_inline_js.js'), htmlComentado]).code === 0,
       'un comprobador que grita donde no hay nada se acaba ignorando');

    // Y el seguro contra el comprobador que deja de comprobar.
    const htmlVacio = temporal('vacio.html', '<html><body><p>sin scripts</p></body></html>\n');
    ok('3f · 🔑🔑 si NO encuentra ni un bloque, lo dice y sale con 1',
       correr([path.join('scripts', '_check_html_inline_js.js'), htmlVacio]).code === 1,
       'un "OK" permanente que no comprueba nada es el defecto que se está arreglando');
}

// ════════════════════════════════════════════════════════════════════
console.log('\n4) 🏷️ El sello de versión: un solo dueño, y comprobable');
{
    const CB = leer('scripts/cache-bust.js');

    ok('4a · `cache-bust.js` tiene modo `--check` que no escribe',
       /SOLO_COMPROBAR/.test(CB) && /includes\('--check'\)/.test(CB) &&
       /if \(!SOLO_COMPROBAR\) fs\.writeFileSync/.test(CB));

    ok('4b · 🔑 y en `--check` SALE CON 1 si algo está desincronizado',
       /if \(SOLO_COMPROBAR && desincronizados\.length\)/.test(CB) && /process\.exit\(1\)/.test(CB));

    // v751 · `const VERSION` de sw.js estaba clavado en 'v736' con el
    // CACHE_NAME en 'v750': catorce versiones de desfase en el dato que se
    // mira justo cuando hay que saber qué copia tiene un navegador.
    ok('4c · 🔑 el sello del SW lo escribe el script, ya no la memoria de nadie',
       /const\\s\+VERSION/.test(CB) && /desincronizados\.push\('sw\.js'\)/.test(CB),
       'tiene que reescribir `const VERSION` de sw.js y contarlo como desincronizado');

    // Y que hoy esté, de hecho, sincronizado.
    const SW = leer('sw.js');
    const vCache = (SW.match(/const\s+CACHE_NAME\s*=\s*'cronos-cache-(v\d+)'/) || [])[1];
    const vSello = (SW.match(/const\s+VERSION\s*=\s*'(v\d+)'/) || [])[1];
    ok('4d · 🔑 EJECUTADO: hoy el sello del SW y el CACHE_NAME coinciden',
       !!vCache && vCache === vSello, 'CACHE_NAME=' + vCache + '  VERSION=' + vSello);

    const r = correr([path.join('scripts', 'cache-bust.js'), '--check']);
    ok('4e · 🔑 EJECUTADO: `cache-bust --check` está en verde ahora mismo',
       r.code === 0, r.salida);
}

limpiar();
console.log('\n──────────────────────────────────────────────────────────');
console.log('Resultado: ' + pass + '/' + (pass + fail) + (fail ? '  ❌' : '  ✅'));
process.exit(fail ? 1 : 0);
